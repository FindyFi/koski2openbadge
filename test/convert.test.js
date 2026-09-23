import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { describe } from 'node:test'

import { convert } from '../index.js'

const sample = JSON.parse(readFileSync(new URL('./fixtures/koski-sample.json', import.meta.url), 'utf8'))

// convert() never mutates its input, but each test gets its own copy so a
// test that tweaks the export to exercise a branch can't leak into another.
function fixture() {
  return structuredClone(sample)
}

function byType(records, achievementType) {
  return records.filter((r) => r.credentialSubject.achievement.achievementType === achievementType)
}

describe('convert', () => {
  test('returns one record per accepted study record', () => {
    const records = convert(fixture(), { lang: 'fi' })

    assert.deepEqual(
      records.map((r) => r.credentialSubject.achievement.achievementType),
      ['BachelorDegree', 'Course', 'Course', 'SecondarySchoolDiploma', 'Assessment']
    )
  })

  test('skips records whose assessment was not accepted', () => {
    const names = convert(fixture(), { lang: 'fi' }).map((r) => r.credentialSubject.achievement.name)

    // The fixture carries a failed course and a failed matriculation test.
    assert.ok(!names.includes('Keskeytynyt kurssi'))
    assert.ok(!names.includes('Ruotsi, keskipitkä oppimäärä'))
  })

  test('uses the person oid as the credential subject id', () => {
    for (const record of convert(fixture(), { lang: 'fi' })) {
      assert.equal(record.credentialSubject.id, 'urn:oid:1.2.246.562.24.00000000001')
      assert.deepEqual(record.credentialSubject.type, ['AchievementSubject'])
    }
  })

  test('returns an empty array for an export with no study records', () => {
    assert.deepEqual(convert({ henkilö: { oid: '1.2.3' } }), [])
    assert.deepEqual(convert({ henkilö: { oid: '1.2.3' }, opiskeluoikeudet: [] }), [])
  })

  test('rejects input that is not a Koski export', () => {
    // Without the guard these fail deep inside the first property access, with
    // a TypeError that says nothing about what the caller got wrong.
    for (const bad of [undefined, null, {}, { henkilö: {} }, 'not json']) {
      assert.throws(() => convert(bad), { name: 'TypeError', message: /henkilö\.oid/ })
    }
  })
})

describe('degrees', () => {
  test('maps the Virta study-right type to an achievement type', () => {
    const master = fixture()
    master.opiskeluoikeudet[0].lisätiedot.virtaOpiskeluoikeudenTyyppi.koodiarvo = '3'
    assert.equal(byType(convert(master), 'MasterDegree').length, 1)

    const unknown = fixture()
    unknown.opiskeluoikeudet[0].lisätiedot.virtaOpiskeluoikeudenTyyppi.koodiarvo = '99'
    assert.equal(byType(convert(unknown), 'Degree').length, 1)
  })

  test('falls back to a plain Degree when the study right has no Virta type', () => {
    const data = fixture()
    delete data.opiskeluoikeudet[0].lisätiedot
    assert.equal(byType(convert(data), 'Degree').length, 1)
  })

  test('carries the degree programme through as fieldOfStudy', () => {
    const [degree] = byType(convert(fixture(), { lang: 'fi' }), 'BachelorDegree')
    assert.equal(degree.credentialSubject.achievement.fieldOfStudy, 'Tietojenkäsittelytiede')
  })

  test('omits an unconfirmed degree but keeps its completed courses', () => {
    const data = fixture()
    delete data.opiskeluoikeudet[0].suoritukset[0].vahvistus

    const records = convert(data, { lang: 'fi' })
    assert.equal(byType(records, 'BachelorDegree').length, 0)
    assert.ok(byType(records, 'Course').some((r) => r.credentialSubject.achievement.humanCode === 'TKT10001'))
  })
})

describe('matriculation examination', () => {
  test('emits the exam and each accepted subject test', () => {
    const records = convert(fixture(), { lang: 'fi' })
    const [exam] = byType(records, 'SecondarySchoolDiploma')
    const tests = byType(records, 'Assessment')

    assert.equal(exam.credentialSubject.achievement.name, 'Ylioppilastutkinto')
    assert.equal(tests.length, 1)
    assert.equal(tests[0].credentialSubject.achievement.name, 'Äidinkieli, suomi')
  })

  test('gives subject tests the confirmation date of the enclosing exam', () => {
    const records = convert(fixture(), { lang: 'fi' })
    const [exam] = byType(records, 'SecondarySchoolDiploma')
    const [subjectTest] = byType(records, 'Assessment')

    // Individual tests carry no vahvistus of their own.
    assert.equal(subjectTest.awardedOn, exam.awardedOn)
    assert.equal(subjectTest.awardedOn, '2018-06-02')
  })

  test('names the examination session in the test description', () => {
    const [subjectTest] = byType(convert(fixture(), { lang: 'fi' }), 'Assessment')
    assert.match(subjectTest.credentialSubject.achievement.description, /kevät 2018/)
  })
})

describe('results', () => {
  function achievementNamed(records, name) {
    return records.find((r) => r.credentialSubject.achievement.name === name)
  }

  test('maps a numeric grade to a 0-5 raw score', () => {
    const record = achievementNamed(convert(fixture(), { lang: 'fi' }), 'Johdatus tietojenkäsittelytieteeseen')
    const { achievement, result } = record.credentialSubject
    const grade = achievement.resultDescription.find((d) => d.id.endsWith('#grade'))

    assert.equal(grade.resultType, 'RawScore')
    assert.equal(grade.valueMin, '0')
    assert.equal(grade.valueMax, '5')
    assert.equal(result.find((r) => r.resultDescription === grade.id).value, '4')
  })

  test('maps a pass/fail grade to a completion status', () => {
    const record = achievementNamed(convert(fixture(), { lang: 'fi' }), 'Ohjelmoinnin perusteet')
    const { achievement, result } = record.credentialSubject
    const grade = achievement.resultDescription.find((d) => d.id.endsWith('#grade'))
    const value = result.find((r) => r.resultDescription === grade.id)

    assert.equal(grade.resultType, 'Status')
    assert.equal(value.status, 'Completed')
  })

  test('maps a matriculation grade to a letter grade with its scale', () => {
    const [subjectTest] = byType(convert(fixture(), { lang: 'fi' }), 'Assessment')
    const { achievement, result } = subjectTest.credentialSubject
    const grade = achievement.resultDescription.find((d) => d.id.endsWith('#grade'))

    assert.equal(grade.resultType, 'LetterGrade')
    assert.deepEqual(grade.allowedValue, ['I', 'A', 'B', 'C', 'M', 'E', 'L'])
    assert.equal(result.find((r) => r.resultDescription === grade.id).value, 'M')
  })

  test('reports course extent as a credits result', () => {
    const record = achievementNamed(convert(fixture(), { lang: 'fi' }), 'Johdatus tietojenkäsittelytieteeseen')
    const { achievement, result } = record.credentialSubject
    const credits = achievement.resultDescription.find((d) => d.id.endsWith('#credits'))

    assert.equal(credits.name, 'Laajuus (opintopistettä)')
    assert.equal(result.find((r) => r.resultDescription === credits.id).value, '5')
  })

  test('omits results entirely when there is nothing to report', () => {
    const [degree] = byType(convert(fixture(), { lang: 'fi' }), 'BachelorDegree')

    assert.ok(!('result' in degree.credentialSubject))
    assert.ok(!('resultDescription' in degree.credentialSubject.achievement))
  })
})

describe('language selection', () => {
  test('picks source text in the requested language', () => {
    const [fi] = byType(convert(fixture(), { lang: 'fi' }), 'BachelorDegree')
    const [sv] = byType(convert(fixture(), { lang: 'sv' }), 'BachelorDegree')
    const [en] = byType(convert(fixture(), { lang: 'en' }), 'BachelorDegree')

    assert.equal(fi.credentialSubject.achievement.name, 'Luonnontieteiden kandidaatti')
    assert.equal(sv.credentialSubject.achievement.name, 'Kandidat i naturvetenskaper')
    assert.equal(en.credentialSubject.achievement.name, 'Bachelor of Science')
  })

  test('generates its own text in the requested language', () => {
    const [fi] = byType(convert(fixture(), { lang: 'fi' }), 'BachelorDegree')
    const [sv] = byType(convert(fixture(), { lang: 'sv' }), 'BachelorDegree')
    const [en] = byType(convert(fixture(), { lang: 'en' }), 'BachelorDegree')

    assert.match(fi.credentialSubject.achievement.criteria.narrative, /^Myönnetty /)
    assert.match(sv.credentialSubject.achievement.criteria.narrative, /^Beviljas /)
    assert.match(en.credentialSubject.achievement.criteria.narrative, /^Awarded /)
  })

  test('defaults to English', () => {
    const [withoutLang] = byType(convert(fixture()), 'BachelorDegree')
    const [english] = byType(convert(fixture(), { lang: 'en' }), 'BachelorDegree')

    assert.deepEqual(withoutLang, english)
  })

  test('falls back to another available language per field', () => {
    // "Ohjelmoinnin perusteet" only exists in Finnish in the fixture.
    const names = convert(fixture(), { lang: 'en' }).map((r) => r.credentialSubject.achievement.name)
    assert.ok(names.includes('Ohjelmoinnin perusteet'))
  })

  test('treats an unsupported language as English', () => {
    const [klingon] = byType(convert(fixture(), { lang: 'tlh' }), 'BachelorDegree')
    assert.match(klingon.credentialSubject.achievement.criteria.narrative, /^Awarded /)
  })

  test('keeps achievement ids stable across languages', () => {
    const ids = (lang) => convert(fixture(), { lang }).map((r) => r.credentialSubject.achievement.id)

    assert.deepEqual(ids('fi'), ids('en'))
    assert.deepEqual(ids('fi'), ids('sv'))
  })
})

describe('organisation profiles', () => {
  test('identifies an organisation by its oid when it has one', () => {
    const [degree] = byType(convert(fixture(), { lang: 'fi' }), 'BachelorDegree')

    assert.deepEqual(degree.credentialSubject.achievement.creator, {
      id: 'urn:oid:1.2.246.562.10.39218317368',
      type: ['Profile'],
      name: 'Helsingin yliopisto',
    })
  })

  test('derives a stable id for an organisation with no oid', () => {
    const data = fixture()
    delete data.opiskeluoikeudet[0].suoritukset[0].vahvistus.myöntäjäOrganisaatio.oid

    const [degree] = byType(convert(data, { lang: 'fi' }), 'BachelorDegree')
    assert.match(degree.credentialSubject.achievement.creator.id, /^urn:opintopolku2openbadge:[0-9a-f]{16}$/)
  })
})
