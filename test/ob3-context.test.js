import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { describe } from 'node:test'

import { convert } from '../index.js'

const sample = JSON.parse(readFileSync(new URL('./fixtures/koski-sample.json', import.meta.url), 'utf8'))

// Every property this package emits has to be a term the Open Badges 3.0
// context actually defines. A property that is not gets silently dropped when
// a verifier expands the JSON-LD - and a signing service running jsonld in
// safe mode (the digitalcredentials one does) refuses to sign the credential
// at all, with an error that says only "Safe mode validation error".
//
// That is worth a test of its own because the shape stays plausible either
// way: `resultDescriptions` shipped for a while, reading perfectly naturally
// next to an array, while OB 3.0 calls it `resultDescription` and declares it
// "@container": "@set" so the singular already takes one.
//
// Term lists transcribed from the type-scoped @contexts in
// https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json.
const GLOBAL_TERMS = ['id', 'type', 'name', 'description', 'narrative', 'image', 'url', 'alignment', 'inLanguage']

const TERMS = {
  AchievementSubject: [
    'achievement', 'activityEndDate', 'activityStartDate', 'creditsEarned', 'identifier',
    'licenseNumber', 'result', 'role', 'source', 'term',
  ],
  Achievement: [
    'achievementType', 'creator', 'creditsAvailable', 'criteria', 'fieldOfStudy', 'humanCode',
    'otherIdentifier', 'related', 'resultDescription', 'specialization', 'tag', 'version',
  ],
  Result: ['achievedLevel', 'resultDescription', 'status', 'value'],
  ResultDescription: ['allowedValue', 'requiredLevel', 'requiredValue', 'resultType', 'rubricCriterionLevel', 'valueMax', 'valueMin'],
  Profile: [
    'additionalName', 'address', 'dateOfBirth', 'email', 'familyName', 'familyNamePrefix',
    'givenName', 'honorificPrefix', 'honorificSuffix', 'official', 'otherIdentifier', 'parentOrg',
    'patronymicName', 'phone',
  ],
}

function assertTermsDefined(object, typeName, path) {
  const allowed = new Set([...GLOBAL_TERMS, ...TERMS[typeName]])
  for (const key of Object.keys(object)) {
    assert.ok(
      allowed.has(key),
      `${path}.${key} is not a term the Open Badges 3.0 context defines for ${typeName}`
    )
  }
}

describe('Open Badges 3.0 context', () => {
  test('emits only terms the context defines', () => {
    const records = convert(structuredClone(sample), { lang: 'fi' })
    assert.ok(records.length > 0, 'fixture produced no records to check')

    for (const [i, record] of records.entries()) {
      const subject = record.credentialSubject
      const at = `records[${i}].credentialSubject`
      assertTermsDefined(subject, 'AchievementSubject', at)

      const { achievement } = subject
      assertTermsDefined(achievement, 'Achievement', `${at}.achievement`)
      if (achievement.creator) assertTermsDefined(achievement.creator, 'Profile', `${at}.achievement.creator`)

      for (const [j, rd] of (achievement.resultDescription ?? []).entries()) {
        assertTermsDefined(rd, 'ResultDescription', `${at}.achievement.resultDescription[${j}]`)
      }
      for (const [j, r] of (subject.result ?? []).entries()) {
        assertTermsDefined(r, 'Result', `${at}.result[${j}]`)
      }
    }
  })

  test('names the achievement result descriptions in the singular', () => {
    // The specific regression: the plural spelling is not in the context.
    const records = convert(structuredClone(sample), { lang: 'fi' })
    const withResults = records.filter((r) => r.credentialSubject.result?.length)
    assert.ok(withResults.length > 0, 'fixture produced no records with results')

    for (const record of withResults) {
      const { achievement } = record.credentialSubject
      assert.ok(!('resultDescriptions' in achievement), 'achievement uses the undefined plural term')
      assert.ok(Array.isArray(achievement.resultDescription), 'achievement.resultDescription should be an array')
    }
  })
})
