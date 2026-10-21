import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { describe } from 'node:test'

import { convert } from '../index.js'

// A person in upper secondary school and in a degree programme at once, with a
// school they left, a separate right to study they never registered for, and
// open studies that ended. Shaped like real exports.
const enrolment = JSON.parse(readFileSync(new URL('./fixtures/koski-enrolment.json', import.meta.url), 'utf8'))
const AS_OF = '2026-10-20T12:00:00Z'

function fixture() {
  return structuredClone(enrolment)
}

function statuses(data, options = {}) {
  return convert(data, { lang: 'en', asOf: AS_OF, ...options }).filter(
    (r) => r.credentialSubject.achievement.achievementType === 'ext:StudentStatus'
  )
}

function institutions(records) {
  return records.map((r) => r.credentialSubject.achievement.creator.name)
}

const upperSecondary = (data) => data.opiskeluoikeudet[0]
const degree = (data) => data.opiskeluoikeudet[2]

describe('student status', () => {
  test('is given for each study right the person is enrolled in', () => {
    assert.deepEqual(institutions(statuses(fixture())), [
      'Example Upper Secondary School',
      'Example University of Applied Sciences',
    ])
  })

  test('says enrolled, at which institution and level', () => {
    const [record] = statuses(fixture())
    const { achievement, result } = record.credentialSubject
    assert.equal(achievement.name, 'Student: General upper secondary education')
    assert.equal(achievement.creator.id, 'urn:oid:1.2.246.562.10.00000000011')
    assert.equal(achievement.fieldOfStudy, 'General upper secondary education syllabus')
    assert.deepEqual(result, [{ type: ['Result'], resultDescription: `${achievement.id}#status`, status: 'Enrolled' }])
    assert.equal(achievement.resultDescription[0].resultType, 'Status')
    assert.match(achievement.description, /Enrolled on 2026-10-20/)
  })

  test('gives the school number of the institution as an other identifier', () => {
    const [school, university] = statuses(fixture())
    assert.deepEqual(school.credentialSubject.achievement.creator.otherIdentifier, [
      { type: ['IdentifierEntry'], identifier: '00565', identifierType: 'identifier' },
    ])
    assert.equal('otherIdentifier' in university.credentialSubject.achievement.creator, false)
  })

  test('leaves out the other identifier when the school number is missing or blank', () => {
    for (const oppilaitosnumero of [undefined, {}, { koodiarvo: '  ' }]) {
      const data = fixture()
      upperSecondary(data).oppilaitos.oppilaitosnumero = oppilaitosnumero
      const [record] = statuses(data)
      assert.equal('otherIdentifier' in record.credentialSubject.achievement.creator, false)
    }
  })

  test('aligns to the sector and the level of education', () => {
    const [school, university] = statuses(fixture())
    const codes = (record) => record.credentialSubject.achievement.alignment.map((a) => [a.targetUrl.split('/').at(-2), a.targetCode, a.targetName])
    assert.deepEqual(codes(school), [
      ['opiskeluoikeudentyyppi', 'lukiokoulutus', 'General upper secondary education'],
      ['kansallinenkoulutusluokitus2016koulutusastetaso1', '3', 'Upper secondary education'],
    ])
    assert.deepEqual(codes(university), [
      ['opiskeluoikeudentyyppi', 'korkeakoulutus', 'Higher education'],
      ['virtaopiskeluoikeudentyyppi', '1', 'Bachelor’s degree from a university of applied sciences'],
      ['kansallinenkoulutusluokitus2016koulutusastetaso1', '6', "Bachelor's or equivalent level"],
    ])
    assert.equal(university.credentialSubject.achievement.name, 'Student: Bachelor’s degree from a university of applied sciences')
  })

  test('leaves the level out without an education code', () => {
    const data = fixture()
    upperSecondary(data).suoritukset = []
    const [record] = statuses(data)
    assert.deepEqual(record.credentialSubject.achievement.alignment.map((a) => a.targetCode), ['lukiokoulutus'])
  })

  test('is valid until the end of the expected end date in Finland', () => {
    const [record] = statuses(fixture())
    assert.equal(record.validUntil, '2027-06-05T20:59:59.000Z')
    assert.equal(record.credentialSubject.activityStartDate, '2024-08-07T21:00:00.000Z')
    assert.ok(!('awardedOn' in record), 'the caller dates a status when it signs it')
  })

  test('in higher education, is valid until the end of the term registered present', () => {
    const [, record] = statuses(fixture())
    assert.equal(record.validUntil, '2026-12-31T21:59:59.000Z')
  })

  test('takes the earliest end Koski gives', () => {
    const data = fixture()
    upperSecondary(data).päättymispäivä = '2026-12-20'
    assert.equal(statuses(data)[0].validUntil, '2026-12-20T21:59:59.000Z')
  })

  test('is not given without any end date', () => {
    const data = fixture()
    delete upperSecondary(data).arvioituPäättymispäivä
    assert.deepEqual(institutions(statuses(data)), ['Example University of Applied Sciences'])
  })

  test('is not given once the expected end has passed', () => {
    assert.deepEqual(institutions(statuses(fixture(), { asOf: '2027-06-05T21:00:00Z' })), [])
  })

  test('counts the day in Finland', () => {
    // 21:30 UTC on 5 June is already 6 June in Finland (UTC+3 in summer).
    const data = fixture()
    assert.equal(statuses(data, { asOf: '2027-06-05T20:30:00Z' }).length, 1)
    assert.equal(statuses(data, { asOf: '2027-06-05T21:30:00Z' }).length, 0)
  })

  test('is not given before the study right starts', () => {
    assert.deepEqual(institutions(statuses(fixture(), { asOf: '2024-08-07T12:00:00Z' })), [])
  })

  test('follows the latest status period that has started', () => {
    const data = fixture()
    upperSecondary(data).tila.opiskeluoikeusjaksot.push({ alku: '2026-11-01', tila: { koodiarvo: 'eronnut', koodistoUri: 'koskiopiskeluoikeudentila' } })
    assert.equal(statuses(data).length, 2, 'a status period in the future does not count yet')
    assert.equal(statuses(data, { asOf: '2026-11-01T12:00:00Z' }).length, 1)
  })

  for (const status of ['loma', 'valiaikaisestikeskeytynyt', 'valmistunut', 'eronnut', 'mitatoity']) {
    test(`is not given when the status is ${status}`, () => {
      const data = fixture()
      upperSecondary(data).tila.opiskeluoikeusjaksot.push({ alku: '2026-09-01', tila: { koodiarvo: status, koodistoUri: 'koskiopiskeluoikeudentila' } })
      assert.deepEqual(institutions(statuses(data)), ['Example University of Applied Sciences'])
    })
  }

  test('in higher education, needs a registration as present for the current term', () => {
    const data = fixture()
    degree(data).lisätiedot.lukukausiIlmoittautuminen.ilmoittautumisjaksot[1].tila.koodiarvo = '2'
    assert.deepEqual(institutions(statuses(data)), ['Example Upper Secondary School'])
    degree(data).lisätiedot.lukukausiIlmoittautuminen.ilmoittautumisjaksot.pop()
    assert.deepEqual(institutions(statuses(data)), ['Example Upper Secondary School'], 'no registration for the term')
  })

  test('is not given for basic education', () => {
    const data = fixture()
    const school = data.opiskeluoikeudet[1]
    delete school.päättymispäivä
    school.arvioituPäättymispäivä = '2027-06-01'
    school.tila.opiskeluoikeusjaksot.pop()
    assert.equal(statuses(data).length, 2)
  })

  test('keeps its id across languages and days', () => {
    const ids = (options) => statuses(fixture(), options).map((r) => r.credentialSubject.achievement.id)
    assert.deepEqual(ids({ lang: 'fi' }), ids({ lang: 'sv', asOf: '2026-11-20T12:00:00Z' }))
  })

  test('is written in the requested language', () => {
    const names = (lang) => statuses(fixture(), { lang }).map((r) => r.credentialSubject.achievement.name)
    assert.deepEqual(names('fi'), ['Opiskelija: Lukiokoulutus', 'Opiskelija: Ammattikorkeakoulututkinto'])
    assert.deepEqual(names('sv'), ['Studerande: Gymnasieutbildning', 'Studerande: Yrkeshögskoleexamen'])
  })

  test('rejects an asOf that is not a date', () => {
    assert.throws(() => convert(fixture(), { asOf: 'yesterday' }), TypeError)
  })
})
