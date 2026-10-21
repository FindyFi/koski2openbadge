# koski2openbadge

Converts study records exported from [Koski](https://koski.opintopolku.fi/koski/) (Oma Koski, the Finnish national
education data registry) into [Open Badges 3.0](https://1edtech.github.io/openbadges-specification/ob_v3p0.html)
achievement data.

## Install

Install it straight from GitHub:

```sh
npm install github:FindyFi/koski2openbadge
```

It has no runtime dependencies; it only uses Node's built-in `node:crypto`. Node 20 or newer is required.

### Not on npm

This package lives on GitHub only and is deliberately not published to the npm registry, so the name
`koski2openbadge` is unclaimed there — anything appearing under it did not come from this project.
`package.json` sets `"private": true` to keep it that way; please leave it in place.

## Usage

```js
import { convert } from 'koski2openbadge'
import data from './my-koski-export.json' with { type: 'json' }

const records = convert(data, { lang: 'fi' })
```

[`test/fixtures/koski-sample.json`](test/fixtures/koski-sample.json) is a small synthetic Koski export you
can try the converter on.

### `convert(data, options?)`

Converts a Koski/Opintopolku study record export into an array of `{ credentialSubject, awardedOn }` items:

- `credentialSubject` is a spec-shaped Open Badges 3.0 `AchievementSubject`.
- `awardedOn` is a plain ISO date fact, left for the calling issuer component to place wherever its target VC Data
  Model version expects it (e.g. `validFrom` or `issuanceDate`). It is the record's own confirmation date
  (`vahvistus.päivä`), or for a subject or course without one (basic and upper secondary education subjects never
  have one) the date of the enclosing suoritus. It is left out when neither has a date, e.g. for subjects of a
  syllabus still in progress.

Koski may leave out any value. The converter never throws on a missing one and never writes one into the text: a
description or criteria narrative drops the clause (institution, date, programme, examination session) whose value
is missing, a record whose module has neither a name nor a code is skipped, and a missing matriculation examination
name falls back to the generic one.

The subject is identified by `id: urn:oid:<henkilö.oid>` (the learner number, not the henkilötunnus) and by an
`identifier` carrying the person's name as an Open Badges 3.0 `IdentityObject`:

```json
{ "type": "IdentityObject", "hashed": false, "identityType": "name", "identityHash": "Testi Opiskelija" }
```

The name is the call name (`kutsumanimi`), or all first names (`etunimet`) when there is none, followed by the
surname (`sukunimi`). Open Badges recommends hashing identifiers where privacy is expected; this one is in plain text
on purpose, so that a verifier can compare it with an ID. Any part may be missing: the name is built from the parts
there are, the `identifier` is left out when there is no name, and `id` is left out when there is no oid.

`holderName(henkilö)` applies the same rule on its own, for callers that show the name; it returns `undefined` when
there is none.

Throws a `TypeError` if `data` has neither a `henkilö.oid` nor a name, since the credential would then not identify
its recipient at all.

The converter itself does not issue or sign credentials — it only produces the achievement data to embed in one.

Recognised study records include:

- Completed courses and their grades/credits (`koulutusmoduuli` sub-achievements)
- Completed degrees (bachelor's/master's), mapped to the corresponding Open Badges `achievementType`
- The Finnish matriculation examination (ylioppilastutkinto) and its individual subject tests
- Subjects of basic and upper secondary education, described as part of their grade year or syllabus
- A student status for each study right the person is enrolled in (see below)

Grades become Open Badges results on the scale of their Koski code set: basic and upper secondary education
(`arviointiasteikkoyleissivistava`) 4–10, higher education (`virtaarvosana`) 0–5, vocational 1–5 or 1–3, as a
`RawScore` with `valueMin`/`valueMax`; the matriculation examination as a `LetterGrade` on I–L; pass marks
(hyväksytty, suoritettu, osallistunut) as a `Completed` status. A grade without a code set is read as 0–5, or 4–10
for 6–10. The extent (`laajuus`) is a result named with its unit from Koski, e.g. "Laajuus (vuosiviikkotuntia)".

Options:

- `lang` — preferred output language (`"fi"`, `"sv"`, or `"en"`). Falls back through the other available languages
  per field if the preferred one is missing, and also selects the language of text the converter itself generates
  (descriptions, criteria narratives, result names). Defaults to `"en"`. Call `convert` once per language if
  multiple language versions are needed.
- `asOf` — the moment to judge enrolment at, a `Date` or an ISO string (default now). Its calendar day in Finland
  is what counts. Throws a `TypeError` if it isn't a date.

### Student status

A study right the person is enrolled in on `asOf` gives one more item, `{ credentialSubject, validUntil }`:

- `achievement.achievementType` is `ext:StudentStatus` (Open Badges 3.0 allows extension values with `ext:`), and the
  subject's `result` has the status `Enrolled`.
- The institution is `achievement.creator`, as for every record; when Koski has its Statistics Finland school number
  (`oppilaitosnumero`), the profile carries it as `otherIdentifier`. The level is in the name ("Opiskelija: Lukiokoulutus") and, for
  machines, in `achievement.alignment`: the Koski study-right type (`opiskeluoikeudentyyppi`), in higher
  education the Virta type (`virtaopiskeluoikeudentyyppi`), and, when the study right has an education code
  (`koulutus`), Statistics Finland's level of education (`kansallinenkoulutusluokitus2016koulutusastetaso1`: the
  code's first digit, which follows the ISCED 2011 levels).
- `activityStartDate` is when the study right started. There is no `awardedOn`: the caller dates the status when
  it signs it.
- `validUntil` is an ISO date-time, the end of the last valid day in Finnish time: the earliest of the expected end
  (`arvioituPäättymispäivä`), the study right's end, and in higher education the end of the current term's
  registration. A study right without any of these gives no status.

Enrolled means: the study right has started and not ended, and its latest started status period is present
(`lasna`), or active (`1`) in higher education, where the current term's registration must also be present.
On leave and temporarily interrupted don't count. Pre-primary and basic education, basic education in the arts
and examinations never give a status.

## Development

```sh
npm test
```

The suite is plain `node --test` with no dependencies, so a fresh clone needs nothing more than
Node 20+; CI runs it on 20, 22 and 24.

A release is just a git tag: bump `version` in `package.json` and tag the commit, so consumers have
something readable to pin.

## License

Apache-2.0
