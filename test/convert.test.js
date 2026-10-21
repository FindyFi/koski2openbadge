import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { describe } from 'node:test'

import { convert, holderName } from '../index.js'

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const sample = load('koski-sample.json')
// Basic and upper secondary education, shaped like a real export: subjects
// carry no vahvistus of their own, and the upper secondary syllabus is still
// unconfirmed.
const school = load('koski-school.json')
// Study rights enrolled in and not, for the student status (see student-status.test.js).
const enrolment = load('koski-enrolment.json')

// convert() never mutates its input, but each test gets its own copy so a
// test that tweaks the export to exercise a branch can't leak into another.
function fixture(source = sample) {
  return structuredClone(source)
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

  test('names the holder in a plain-text name identifier', () => {
    for (const record of convert(fixture(), { lang: 'fi' })) {
      assert.deepEqual(record.credentialSubject.identifier, [
        { type: 'IdentityObject', hashed: false, identityType: 'name', identityHash: 'Testi Tapaus Opiskelija' },
      ])
    }
  })

  test('prefers the call name to all first names', () => {
    const data = fixture()
    data.henkilö.kutsumanimi = 'Tapaus'
    const [record] = convert(data)
    assert.equal(record.credentialSubject.identifier[0].identityHash, 'Tapaus Opiskelija')
  })

  test('builds the name from whatever parts there are', () => {
    const cases = [
      [{ etunimet: 'Testi', sukunimi: undefined }, 'Testi'],
      [{ etunimet: undefined, sukunimi: 'Opiskelija' }, 'Opiskelija'],
      [{ kutsumanimi: '  ', etunimet: ' Testi  Tapaus ', sukunimi: 'Opiskelija ' }, 'Testi Tapaus Opiskelija'],
      [{ etunimet: 42, sukunimi: 'Opiskelija' }, 'Opiskelija'],
    ]
    for (const [parts, expected] of cases) {
      const data = fixture()
      data.henkilö = { oid: data.henkilö.oid, ...parts }
      const [record] = convert(data)
      assert.equal(record.credentialSubject.identifier[0].identityHash, expected)
    }
  })

  test('exports the name rule for callers that show the name', () => {
    assert.equal(holderName({ kutsumanimi: 'Tapaus', etunimet: 'Testi Tapaus', sukunimi: 'Opiskelija' }), 'Tapaus Opiskelija')
    assert.equal(holderName({}), undefined)
    assert.equal(holderName(undefined), undefined)
  })

  test('leaves the identifier out when there is no name', () => {
    const data = fixture()
    data.henkilö = { oid: data.henkilö.oid, etunimet: '', sukunimi: null }
    for (const record of convert(data)) {
      assert.ok(!('identifier' in record.credentialSubject))
      assert.equal(record.credentialSubject.id, 'urn:oid:1.2.246.562.24.00000000001')
    }
  })

  test('leaves the subject id out when there is no oid, and relies on the name', () => {
    const data = fixture()
    delete data.henkilö.oid
    const records = convert(data)
    assert.ok(records.length > 0)
    for (const record of records) {
      assert.ok(!('id' in record.credentialSubject))
      assert.equal(record.credentialSubject.identifier[0].identityHash, 'Testi Tapaus Opiskelija')
    }
  })

  test('returns an empty array for an export with no study records', () => {
    assert.deepEqual(convert({ henkilö: { oid: '1.2.3' } }), [])
    assert.deepEqual(convert({ henkilö: { oid: '1.2.3' }, opiskeluoikeudet: [] }), [])
  })

  test('rejects input that is not a Koski export', () => {
    // Without the guard these fail deep inside the first property access, with
    // a TypeError that says nothing about what the caller got wrong.
    const nameless = { henkilö: { oid: ' ', etunimet: '', sukunimi: null }, opiskeluoikeudet: [] }
    for (const bad of [undefined, null, {}, { henkilö: {} }, 'not json', nameless]) {
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

  function gradeOf(record) {
    const { achievement, result } = record.credentialSubject
    const description = achievement.resultDescription.find((d) => d.id.endsWith('#grade'))
    const { value, status } = result.find((r) => r.resultDescription === description.id)
    return { resultType: description.resultType, valueMin: description.valueMin, valueMax: description.valueMax, value, status }
  }

  test('maps a school grade to a 4-10 raw score, even a 5', () => {
    const courses = byType(convert(fixture(school), { lang: 'fi' }), 'Course')

    assert.deepEqual(gradeOf(courses[0]), { resultType: 'RawScore', valueMin: '4', valueMax: '10', value: '5', status: undefined })
    assert.deepEqual(gradeOf(courses[1]), { resultType: 'RawScore', valueMin: '4', valueMax: '10', value: '9', status: undefined })
  })

  test('maps a school pass mark to a completion status', () => {
    const pe = achievementNamed(convert(fixture(school), { lang: 'fi' }), 'Liikunta')

    assert.deepEqual(gradeOf(pe), { resultType: 'Status', valueMin: undefined, valueMax: undefined, value: undefined, status: 'Completed' })
  })

  test('reads the scale from the grade code set', () => {
    const grade = (arvosana) => {
      const data = fixture()
      data.opiskeluoikeudet[0].suoritukset[0].osasuoritukset[0].arviointi = [{ hyväksytty: true, arvosana }]
      return gradeOf(achievementNamed(convert(data, { lang: 'fi' }), 'Johdatus tietojenkäsittelytieteeseen'))
    }

    assert.deepEqual(
      [
        grade({ koodiarvo: '5', koodistoUri: 'virtaarvosana' }),
        grade({ koodiarvo: '3', koodistoUri: 'arviointiasteikkoammatillinen15' }),
        grade({ koodiarvo: '2', koodistoUri: 'arviointiasteikkoammatillinent1k3' }),
        grade({ koodiarvo: '7' }),
      ].map(({ value, valueMin, valueMax }) => [value, valueMin, valueMax]),
      [
        ['5', '0', '5'],
        ['3', '1', '5'],
        ['2', '1', '3'],
        ['7', '4', '10'],
      ]
    )
    // A numeric grade on a scale we don't know is shown by its name.
    assert.deepEqual(grade({ koodiarvo: '3', koodistoUri: 'tuntematon', nimi: { fi: 'hyvä' } }).value, 'hyvä')
  })

  test('reports course extent as a credits result', () => {
    const record = achievementNamed(convert(fixture(), { lang: 'fi' }), 'Johdatus tietojenkäsittelytieteeseen')
    const { achievement, result } = record.credentialSubject
    const credits = achievement.resultDescription.find((d) => d.id.endsWith('#credits'))

    assert.equal(credits.name, 'Laajuus (opintopistettä)')
    assert.equal(result.find((r) => r.resultDescription === credits.id).value, '5')
  })

  test('names the unit of the extent as Koski gives it', () => {
    const extentName = (data, lang, name) =>
      achievementNamed(convert(data, { lang }), name).credentialSubject.achievement.resultDescription.find((d) =>
        d.id.endsWith('#credits')
      ).name

    assert.equal(extentName(fixture(school), 'fi', 'Matematiikka'), 'Laajuus (vuosiviikkotuntia)')
    assert.equal(extentName(fixture(school), 'en', 'Mathematics'), 'Extent (weekly lessons per year)')
    assert.equal(extentName(fixture(school), 'sv', 'Matematik'), 'Omfattning (årsveckotimmar)')

    const unitless = fixture()
    delete unitless.opiskeluoikeudet[0].suoritukset[0].osasuoritukset[0].koulutusmoduuli.laajuus.yksikkö
    assert.equal(extentName(unitless, 'fi', 'Johdatus tietojenkäsittelytieteeseen'), 'Laajuus')
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

  test('gives the school number as an other identifier when Koski has one', () => {
    const data = fixture()
    data.opiskeluoikeudet[0].suoritukset[0].vahvistus.myöntäjäOrganisaatio.oppilaitosnumero = { koodiarvo: '01901' }

    const [degree] = byType(convert(data, { lang: 'fi' }), 'BachelorDegree')
    assert.deepEqual(degree.credentialSubject.achievement.creator.otherIdentifier, [
      { type: ['IdentifierEntry'], identifier: '01901', identifierType: 'identifier' },
    ])
  })

  test('derives a stable id for an organisation with no oid', () => {
    const data = fixture()
    delete data.opiskeluoikeudet[0].suoritukset[0].vahvistus.myöntäjäOrganisaatio.oid

    const [degree] = byType(convert(data, { lang: 'fi' }), 'BachelorDegree')
    assert.match(degree.credentialSubject.achievement.creator.id, /^urn:opintopolku2openbadge:[0-9a-f]{16}$/)
  })
})

describe('school subjects', () => {
  test('take the confirmation date of the enclosing suoritus', () => {
    const courses = byType(convert(fixture(school), { lang: 'fi' }), 'Course')

    assert.deepEqual(
      courses.map((r) => r.awardedOn),
      ['2023-06-03', '2023-06-03', '2023-06-03', '2024-06-01', '2024-06-01', '2024-06-01', undefined]
    )
    assert.equal(
      courses[0].credentialSubject.achievement.description,
      'Äidinkieli ja kirjallisuus, osa kokonaisuutta 8. vuosiluokka oppilaitoksessa Esimerkkikoulu. Suoritettu 2023-06-03.'
    )
  })

  test('leave the date out when no suoritus has one', () => {
    const unconfirmed = byType(convert(fixture(school), { lang: 'en' }), 'Course').at(-1)

    assert.equal(unconfirmed.awardedOn, undefined)
    assert.equal(
      unconfirmed.credentialSubject.achievement.description,
      'Äidinkieli ja kirjallisuus, part of General upper secondary education syllabus at Example Upper Secondary School.'
    )
  })

  test('name the grade year or syllabus they belong to', () => {
    const maths = byType(convert(fixture(school), { lang: 'fi' }), 'Course')
      .filter((r) => r.credentialSubject.achievement.name === 'Matematiikka')
      .map((r) => r.credentialSubject.achievement.description)

    assert.deepEqual(maths, [
      'Matematiikka, osa kokonaisuutta 8. vuosiluokka oppilaitoksessa Esimerkkikoulu. Suoritettu 2023-06-03.',
      'Matematiikka, osa kokonaisuutta 9. vuosiluokka oppilaitoksessa Esimerkkikoulu. Suoritettu 2024-06-01.',
      'Matematiikka, osa kokonaisuutta Perusopetus oppilaitoksessa Esimerkkikoulu. Suoritettu 2024-06-01.',
    ])
  })

  test('say what was taught when the suoritus has no name', () => {
    const data = fixture(school)
    delete data.opiskeluoikeudet[0].suoritukset[0].koulutusmoduuli

    const [first] = byType(convert(data, { lang: 'fi' }), 'Course')
    assert.equal(
      first.credentialSubject.achievement.description,
      'Äidinkieli ja kirjallisuus, suoritettu oppilaitoksessa Esimerkkikoulu 2023-06-03.'
    )
  })

  test('stay apart when two suoritukset confirmed on one day hold the same subject', () => {
    // Mathematics in grade 9 and in the syllabus, both confirmed 2024-06-01.
    const ids = byType(convert(fixture(school), { lang: 'fi' }), 'Course').map((r) => r.credentialSubject.achievement.id)

    assert.equal(new Set(ids).size, ids.length)
  })

  test('leave the ids of courses with a date of their own as they were', () => {
    assert.deepEqual(
      convert(fixture(), { lang: 'fi' }).map((r) => r.credentialSubject.achievement.id),
      [
        'urn:opintopolku2openbadge:11b07ca1a4c8a2ef',
        'urn:opintopolku2openbadge:be6e5376959a7dd2',
        'urn:opintopolku2openbadge:ca6d618f0a3e2c70',
        'urn:opintopolku2openbadge:e77312d1bc60b543',
        'urn:opintopolku2openbadge:1e62565e79e65aae',
      ]
    )
  })
})

// Koski may leave out any value. Whatever is missing, convert() must neither
// throw (other than for a recipient it can't identify) nor write a missing
// value into the text.
describe('missing values', () => {
  const BAD_TEXT = /undefined|null|NaN|\[object |\s{2}|\s[.,)]|\(\)|^\s|\s$/

  // Every path to a value in the export, outermost first.
  function paths(value, prefix = []) {
    if (!value || typeof value !== 'object') return []
    return Object.entries(value).flatMap(([key, child]) => [[...prefix, key], ...paths(child, [...prefix, key])])
  }

  function without(data, path, replacement) {
    const copy = structuredClone(data)
    const parent = path.slice(0, -1).reduce((node, key) => node[key], copy)
    if (replacement === undefined) delete parent[path.at(-1)]
    else parent[path.at(-1)] = replacement
    return copy
  }

  function badStrings(value, at = '') {
    if (typeof value === 'string') return BAD_TEXT.test(value) ? [`${at}: ${JSON.stringify(value)}`] : []
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => badStrings(v, `${at}.${k}`))
    return []
  }

  const sources = [
    ['higher education and matriculation', sample],
    ['school', school],
    ['student status', enrolment],
  ]
  for (const [name, source] of sources) {
    test(`never writes a missing value into the text (${name})`, () => {
      for (const path of paths(source)) {
        for (const replacement of [undefined, null, '', {}]) {
          const data = without(source, path, replacement)
          for (const lang of ['fi', 'en', 'sv']) {
            let records
            try {
              records = convert(data, { lang, asOf: '2026-10-20T12:00:00Z' })
            } catch (err) {
              // Only an unidentifiable recipient may throw.
              assert.equal(path[0], 'henkilö', `${path.join('.')} = ${JSON.stringify(replacement)}: ${err.message}`)
              continue
            }
            assert.deepEqual(badStrings(records), [], `${path.join('.')} = ${JSON.stringify(replacement)}, ${lang}`)
          }
        }
      }
    })
  }
})
