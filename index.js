import { createHash } from 'node:crypto'

const LANGS = ['en', 'fi', 'sv']
const ID_NS = 'urn:opintopolku2openbadge'

// Finnish matriculation examination grade scale, worst to best.
const YO_GRADE_SCALE = ['I', 'A', 'B', 'C', 'M', 'E', 'L']

// Numeric grade scales [min, max], keyed by the arvosana's Koski code set.
const NUMERIC_GRADE_SCALES = {
  arviointiasteikkoyleissivistava: [4, 10], // basic and upper secondary education
  virtaarvosana: [0, 5], // higher education
  arviointiasteikkoammatillinen15: [1, 5], // vocational
  arviointiasteikkoammatillinent1k3: [1, 3], // vocational, older
}

// Pass marks without a grade: hyväksytty (higher education, vocational),
// suoritettu and osallistunut (basic and upper secondary education).
const PASS_GRADES = ['HYV', 'Hyväksytty', 'S', 'O']

// Virta study-right type code -> OB3 achievementType for a completed degree.
const DEGREE_ACHIEVEMENT_TYPE = {
  1: 'BachelorDegree',
  3: 'MasterDegree',
}

// Text the converter itself generates (descriptions, criteria narratives,
// result names), as opposed to text picked from the source data. Keyed by
// output language; selected via the `lang` option to `convert()`. Koski may
// leave out any value, so every clause built from one (institution, date,
// programme, session) is dropped when the value is missing; only `name` is
// always there (records without one are skipped).
const MESSAGES = {
  en: {
    gradeName: 'Grade',
    extentName: (unit) => `Extent${clause(' (', unit, ')')}`,
    matriculationExamName: 'Finnish Matriculation Examination',
    courseDescriptionWithContext: (name, programmeContext, institutionName, date) =>
      `${name}, part of ${programmeContext}${clause(' at ', institutionName)}.${clause(' Completed ', date, '.')}`,
    courseDescription: (name, institutionName, date) =>
      `${name}, completed${clause(' at ', institutionName)}${clause(' on ', date)}.`,
    courseCriteria: (name, institutionName) =>
      `Awarded upon successful completion of the course "${name}"${clause(' at ', institutionName)}, as recorded in the Finnish national education data registry (Koski).`,
    degreeDescription: (name, programmeName, institutionName, date) =>
      `${name}${clause(' (', programmeName, ')')}, awarded${clause(' by ', institutionName)}${clause(' on ', date)}.`,
    degreeCriteria: (programmeOrName, institutionName) =>
      `Awarded upon successful completion of the ${programmeOrName} degree programme${clause(' at ', institutionName)}, as recorded in the Finnish national education data registry (Koski).`,
    matriculationExamDescription: (institutionName, date) =>
      `Finnish Matriculation Examination${institutionName || date ? `, confirmed${clause(' by ', institutionName)}${clause(' on ', date)}` : ''}.`,
    matriculationExamCriteria: () =>
      'Awarded upon passing the required tests of the Finnish Matriculation Examination, as recorded by the Matriculation Examination Board (Ylioppilastutkintolautakunta).',
    matriculationTestDescription: (name, sessionLabel) =>
      `${name} test of the Finnish Matriculation Examination${clause(', ', sessionLabel)}.`,
    matriculationTestCriteria: (name) => `Awarded upon passing the "${name}" test of the Finnish Matriculation Examination.`,
  },
  fi: {
    gradeName: 'Arvosana',
    extentName: (unit) => `Laajuus${clause(' (', unit, ')')}`,
    matriculationExamName: 'Ylioppilastutkinto',
    courseDescriptionWithContext: (name, programmeContext, institutionName, date) =>
      `${name}, osa kokonaisuutta ${programmeContext}${clause(' oppilaitoksessa ', institutionName)}.${clause(' Suoritettu ', date, '.')}`,
    courseDescription: (name, institutionName, date) =>
      `${name}, suoritettu${clause(' oppilaitoksessa ', institutionName)}${clause(' ', date)}.`,
    courseCriteria: (name, institutionName) =>
      `Myönnetty kurssin "${name}" suorittamisesta${clause(' oppilaitoksessa ', institutionName)}, kirjattu Opetushallituksen Koski-tietovarantoon.`,
    // "myöntänyt <who>" needs the institution; without it, "myönnetty <when>".
    degreeDescription: (name, programmeName, institutionName, date) =>
      `${name}${clause(' (', programmeName, ')')}${
        institutionName ? `, myöntänyt ${institutionName}${clause(' ', date)}` : clause(', myönnetty ', date)
      }.`,
    degreeCriteria: (programmeOrName, institutionName) =>
      `Myönnetty ${programmeOrName}-tutkinto-ohjelman suorittamisesta${clause(' oppilaitoksessa ', institutionName)}, kirjattu Opetushallituksen Koski-tietovarantoon.`,
    matriculationExamDescription: (institutionName, date) =>
      `Ylioppilastutkinto${
        institutionName ? `, vahvistanut ${institutionName}${clause(' ', date)}` : clause(', vahvistettu ', date)
      }.`,
    matriculationExamCriteria: () =>
      'Myönnetty ylioppilastutkinnon vaadittujen kokeiden suorittamisesta, Ylioppilastutkintolautakunnan kirjaama.',
    matriculationTestDescription: (name, sessionLabel) => `${name}, ylioppilastutkinnon koe${clause(', ', sessionLabel)}.`,
    matriculationTestCriteria: (name) => `Myönnetty ylioppilastutkinnon kokeen "${name}" suorittamisesta.`,
  },
  sv: {
    gradeName: 'Vitsord',
    extentName: (unit) => `Omfattning${clause(' (', unit, ')')}`,
    matriculationExamName: 'Studentexamen',
    courseDescriptionWithContext: (name, programmeContext, institutionName, date) =>
      `${name}, del av ${programmeContext}${clause(' vid ', institutionName)}.${clause(' Avlagd ', date, '.')}`,
    courseDescription: (name, institutionName, date) =>
      `${name}, avlagd${clause(' vid ', institutionName)}${clause(' den ', date)}.`,
    courseCriteria: (name, institutionName) =>
      `Beviljas för avlagd kurs "${name}"${clause(' vid ', institutionName)}, registrerad i Utbildningsstyrelsens datalager Koski.`,
    degreeDescription: (name, programmeName, institutionName, date) =>
      `${name}${clause(' (', programmeName, ')')}, utfärdad${clause(' av ', institutionName)}${clause(' den ', date)}.`,
    degreeCriteria: (programmeOrName, institutionName) =>
      `Beviljas för avlagd examen ${programmeOrName}${clause(' vid ', institutionName)}, registrerad i Utbildningsstyrelsens datalager Koski.`,
    matriculationExamDescription: (institutionName, date) =>
      `Studentexamen${institutionName || date ? `, fastställd${clause(' av ', institutionName)}${clause(' den ', date)}` : ''}.`,
    matriculationExamCriteria: () =>
      'Beviljas för avlagda obligatoriska prov i studentexamen, registrerad av Studentexamensnämnden.',
    matriculationTestDescription: (name, sessionLabel) => `${name}, prov i studentexamen${clause(', ', sessionLabel)}.`,
    matriculationTestCriteria: (name) => `Beviljas för godkänt prov "${name}" i studentexamen.`,
  },
}

// `before + value + after` when there is a value, otherwise nothing.
function clause(before, value, after = '') {
  return value ? `${before}${value}${after}` : ''
}

function resolveLang(lang) {
  return LANGS.includes(lang) ? lang : 'en'
}

function pickLang(langMap, langs) {
  if (!langMap || typeof langMap !== 'object') return undefined
  for (const lang of langs) {
    const text = nonEmpty(langMap[lang])
    if (text) return text
  }
  return Object.values(langMap).map(nonEmpty).find(Boolean)
}

// A language-independent name, used only for deriving stable ids (never for
// display) so that achievement/organisation ids don't change depending on
// which `lang` a given `convert()` call requested.
function canonicalName(nameMap) {
  return pickLang(nameMap, LANGS)
}

function hashId(parts) {
  const hash = createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16)
  return `${ID_NS}:${hash}`
}

// The objects in a list from the export; anything else (a missing list, a
// null entry) is left out rather than thrown on.
function items(list) {
  return Array.isArray(list) ? list.filter((item) => item && typeof item === 'object') : []
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// The name the person goes by: the call name (kutsumanimi) if Koski has one,
// otherwise all first names, then the surname. Any part may be missing; the
// result is undefined when none is there.
export function holderName(henkilö) {
  const given = nonEmpty(henkilö?.kutsumanimi) ?? nonEmpty(henkilö?.etunimet)
  const name = [given, nonEmpty(henkilö?.sukunimi)].filter(Boolean).join(' ')
  return name.replace(/\s+/g, ' ') || undefined
}

// An Open Badges 3.0 IdentityObject carrying the name in plain text. The spec
// recommends hashing where privacy is expected; the name is in plain text on
// purpose, so that a verifier can compare it with an ID. The credential stays
// private until the person shares it, and once they do, it is meant to say
// who they are.
function nameIdentifier(name) {
  return { type: 'IdentityObject', hashed: false, identityType: 'name', identityHash: name }
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue
      out[key] = compact(val)
    }
    return out
  }
  return value
}

function orgProfile(org, pick) {
  if (!org) return undefined
  return {
    id: nonEmpty(org.oid) ? `urn:oid:${nonEmpty(org.oid)}` : hashId(['org', canonicalName(org.nimi)]),
    type: ['Profile'],
    name: pick(org.nimi),
  }
}

function acceptedAssessment(arviointi) {
  return items(arviointi).find((a) => a.hyväksytty) ?? null
}

// The scale a numeric grade is on: from its code set when Koski names one,
// otherwise guessed from the value (0-5 higher education, 6-10 school).
function numericScale(arvosana, koodi) {
  const scale = arvosana.koodistoUri ? NUMERIC_GRADE_SCALES[arvosana.koodistoUri] : /^[6-9]$|^10$/.test(koodi) ? [4, 10] : [0, 5]
  const value = /^\d+$/.test(koodi) ? Number(koodi) : NaN
  return scale && value >= scale[0] && value <= scale[1] ? scale : null
}

function gradeResultSpec(arvosana, pick) {
  if (!arvosana || typeof arvosana !== 'object') return null
  const koodi = nonEmpty(arvosana.koodiarvo)
  if (PASS_GRADES.includes(koodi)) {
    return { resultType: 'Status', status: 'Completed' }
  }
  const scale = numericScale(arvosana, koodi)
  if (scale) {
    return { resultType: 'RawScore', value: koodi, valueMin: String(scale[0]), valueMax: String(scale[1]) }
  }
  if (YO_GRADE_SCALE.includes(koodi)) {
    return { resultType: 'LetterGrade', value: koodi, allowedValue: YO_GRADE_SCALE }
  }
  const name = nonEmpty(pick(arvosana.nimi)) ?? koodi
  return name ? { resultType: 'LetterGrade', value: name } : null
}

function buildResults(achievementId, { grade, laajuus, pick, t }) {
  const resultDescriptions = []
  const results = []

  if (grade) {
    const id = `${achievementId}#grade`
    resultDescriptions.push({
      id,
      type: ['ResultDescription'],
      name: t.gradeName,
      resultType: grade.resultType,
      allowedValue: grade.allowedValue,
      valueMin: grade.valueMin,
      valueMax: grade.valueMax,
    })
    results.push({ type: ['Result'], resultDescription: id, value: grade.value, status: grade.status })
  }

  const credits = laajuus?.arvo
  if ((typeof credits === 'number' || nonEmpty(credits)) && Number.isFinite(Number(credits))) {
    const id = `${achievementId}#credits`
    resultDescriptions.push({
      id,
      type: ['ResultDescription'],
      name: t.extentName(nonEmpty(pick(laajuus.yksikkö?.nimi))),
      resultType: 'RawScore',
      valueMin: '0',
    })
    results.push({ type: ['Result'], resultDescription: id, value: String(credits).trim() })
  }

  return { resultDescriptions, results }
}

// Builds one output item: a spec-shaped `credentialSubject` plus `awardedOn`,
// a plain sibling fact (not a VC property) for the parent/issuer component to
// map onto whatever VC Data Model version and envelope it targets.
function buildRecord(
  pick,
  {
    subjectId,
    identifier,
    idParts,
    achievementType,
    name,
    description,
    criteriaNarrative,
    creatorOrg,
    fieldOfStudy,
    humanCode,
    grade,
    laajuus,
    awardedOn,
    t,
  }
) {
  const achievementId = hashId(idParts)
  const { resultDescriptions, results } = buildResults(achievementId, { grade, laajuus, pick, t })

  return compact({
    credentialSubject: {
      type: ['AchievementSubject'],
      id: subjectId,
      identifier,
      achievement: {
        id: achievementId,
        type: ['Achievement'],
        achievementType,
        name,
        description,
        humanCode,
        fieldOfStudy,
        criteria: { narrative: criteriaNarrative },
        creator: orgProfile(creatorOrg, pick),
        // Singular: Open Badges 3.0 names this `resultDescription` and declares
        // it "@container": "@set", so it already takes the array. The plural
        // spelling is not a term in the context, which means a signing service
        // running jsonld in safe mode rejects the whole credential.
        resultDescription: resultDescriptions.length ? resultDescriptions : undefined,
      },
      result: results.length ? results : undefined,
    },
    awardedOn,
  })
}

function isCompleted(unit) {
  // Matriculation exam subject tests carry `arviointi` but no `vahvistus` of
  // their own (confirmation lives on the enclosing suoritus), so accept
  // either signal rather than requiring both.
  if (unit.arviointi) return Boolean(acceptedAssessment(unit.arviointi))
  return Boolean(unit.vahvistus)
}

// The module's name, or its code when Koski gives no name. Undefined when
// neither is there; such a record is skipped, since an achievement without a
// name says nothing.
function moduleName(km, pick) {
  return nonEmpty(pick(km?.tunniste?.nimi)) ?? nonEmpty(pick(km?.nimi)) ?? nonEmpty(km?.tunniste?.koodiarvo)
}

function courseRecord(
  { subjectId, identifier, pick, t },
  osasuoritus,
  { institution, fieldOfStudy, programmeContext, parent }
) {
  const km = osasuoritus.koulutusmoduuli
  const name = moduleName(km, pick)
  if (!name) return null
  const creatorOrg = osasuoritus.vahvistus?.myöntäjäOrganisaatio ?? osasuoritus.toimipiste ?? institution
  const institutionName = pick(creatorOrg?.nimi)
  // Subjects in basic and upper secondary education have no vahvistus of
  // their own: they are confirmed with the enclosing suoritus (a grade year or
  // the syllabus), so take its date. The enclosing suoritus then also goes into
  // the id, so that the same subject in two suoritukset confirmed on the same
  // day stays two achievements. Courses with a date of their own keep the ids
  // they had before.
  const ownDate = nonEmpty(osasuoritus.vahvistus?.päivä)
  const date = ownDate ?? nonEmpty(parent?.vahvistus?.päivä)
  const parentKey = ownDate || !date ? [] : [parent?.tyyppi?.koodiarvo, parent?.koulutusmoduuli?.tunniste?.koodiarvo]
  const accepted = acceptedAssessment(osasuoritus.arviointi)

  const description = programmeContext
    ? t.courseDescriptionWithContext(name, programmeContext, institutionName, date)
    : t.courseDescription(name, institutionName, date)

  return buildRecord(pick, {
    subjectId,
    identifier,
    idParts: [creatorOrg?.oid ?? canonicalName(creatorOrg?.nimi), km?.tunniste?.koodiarvo, date, ...parentKey],
    achievementType: 'Course',
    name,
    description,
    criteriaNarrative: t.courseCriteria(name, institutionName),
    creatorOrg,
    fieldOfStudy,
    humanCode: km?.tunniste?.koodiarvo,
    grade: gradeResultSpec(accepted?.arvosana, pick),
    laajuus: km?.laajuus,
    awardedOn: date,
    t,
  })
}

function degreeRecord({ subjectId, identifier, pick, t }, suoritus, opiskeluoikeus) {
  const km = suoritus.koulutusmoduuli
  const name = moduleName(km, pick)
  if (!name) return null
  const programmeName = nonEmpty(pick(km?.virtaNimi))
  const institution = suoritus.vahvistus?.myöntäjäOrganisaatio ?? opiskeluoikeus.oppilaitos
  const institutionName = pick(institution?.nimi)
  const date = nonEmpty(suoritus.vahvistus?.päivä)
  const virtaCode = opiskeluoikeus.lisätiedot?.virtaOpiskeluoikeudenTyyppi?.koodiarvo
  const achievementType = DEGREE_ACHIEVEMENT_TYPE[virtaCode] ?? 'Degree'

  return buildRecord(pick, {
    subjectId,
    identifier,
    idParts: [opiskeluoikeus.lähdejärjestelmänId?.id, km?.tunniste?.koodiarvo, date],
    achievementType,
    name,
    description: t.degreeDescription(name, programmeName, institutionName, date),
    criteriaNarrative: t.degreeCriteria(programmeName ?? name, institutionName),
    creatorOrg: institution,
    fieldOfStudy: programmeName,
    grade: gradeResultSpec(acceptedAssessment(suoritus.arviointi)?.arvosana, pick),
    awardedOn: date,
    t,
  })
}

function matriculationExamRecord({ subjectId, identifier, pick, t }, suoritus, opiskeluoikeus) {
  const institution = suoritus.vahvistus?.myöntäjäOrganisaatio ?? suoritus.toimipiste ?? opiskeluoikeus.koulutustoimija
  const institutionName = pick(institution?.nimi)
  const date = nonEmpty(suoritus.vahvistus?.päivä)

  return buildRecord(pick, {
    subjectId,
    identifier,
    idParts: ['ylioppilastutkinto', institution?.oid, date],
    achievementType: 'SecondarySchoolDiploma',
    name: nonEmpty(pick(suoritus.koulutusmoduuli?.tunniste?.nimi)) ?? t.matriculationExamName,
    description: t.matriculationExamDescription(institutionName, date),
    criteriaNarrative: t.matriculationExamCriteria(),
    creatorOrg: institution,
    awardedOn: date,
    t,
  })
}

function matriculationTestRecord({ subjectId, identifier, pick, t }, koe, institution, awardedOn) {
  const km = koe.koulutusmoduuli
  const name = moduleName(km, pick)
  if (!name) return null
  const session = koe.tutkintokerta
  const year = Number.isInteger(session?.vuosi) ? String(session.vuosi) : nonEmpty(session?.vuosi)
  const sessionLabel = [pick(session?.vuodenaika), year].filter(Boolean).join(' ') || undefined
  const accepted = acceptedAssessment(koe.arviointi)

  return buildRecord(pick, {
    subjectId,
    identifier,
    idParts: ['yo-koe', km?.tunniste?.koodiarvo, session?.koodiarvo],
    achievementType: 'Assessment',
    name,
    description: t.matriculationTestDescription(name, sessionLabel),
    criteriaNarrative: t.matriculationTestCriteria(name),
    creatorOrg: institution,
    humanCode: km?.tunniste?.koodiarvo,
    grade: gradeResultSpec(accepted?.arvosana, pick),
    // Individual exam tests have no vahvistus of their own; fall back to the
    // confirmation date of the enclosing matriculation exam record.
    awardedOn,
    t,
  })
}

/**
 * Convert a Koski/Opintopolku study record export into an array of
 * `{ credentialSubject, awardedOn }` items. `credentialSubject` is a spec-shaped
 * Open Badges 3.0 AchievementSubject; `awardedOn` is a plain ISO date fact for
 * a calling issuer component to place wherever its target VC Data Model
 * version expects it (e.g. `validFrom` or `issuanceDate`).
 *
 * @param {object} data - a Koski/Opintopolku study record export.
 * @param {object} [options]
 * @param {string} [options.lang] - preferred output language (e.g. "fi", "sv",
 *   "en"); falls back through the other available languages per field, and
 *   also selects the language of text the converter itself generates
 *   (descriptions, criteria narratives, result names), defaulting to "en".
 *   Call `convert` once per language if multiple language versions are needed.
 * @returns {Array<{credentialSubject: object, awardedOn: string|undefined}>}
 * @throws {TypeError} if `data` is not a Koski export with a `henkilö.oid` or
 *   the person's name: without either, a credential would not identify its
 *   recipient at all.
 */
export function convert(data, { lang } = {}) {
  const oid = nonEmpty(data?.henkilö?.oid)
  const name = holderName(data?.henkilö)
  if (!oid && !name) {
    throw new TypeError('convert() expects a Koski study record export with a `henkilö.oid` or the person\'s name.')
  }

  const langs = lang ? [lang, ...LANGS.filter((l) => l !== lang)] : LANGS
  const pick = (langMap) => pickLang(langMap, langs)
  const t = MESSAGES[resolveLang(lang)]
  const ctx = {
    subjectId: oid ? `urn:oid:${oid}` : undefined,
    identifier: name ? [nameIdentifier(name)] : undefined,
    pick,
    t,
  }
  const out = []

  for (const opiskeluoikeus of items(data.opiskeluoikeudet)) {
    if (opiskeluoikeus.tyyppi?.koodiarvo === 'ylioppilastutkinto') {
      for (const suoritus of items(opiskeluoikeus.suoritukset)) {
        if (!isCompleted(suoritus)) continue
        out.push(matriculationExamRecord(ctx, suoritus, opiskeluoikeus))

        const institution = suoritus.vahvistus?.myöntäjäOrganisaatio ?? suoritus.toimipiste
        const awardedOn = nonEmpty(suoritus.vahvistus?.päivä)
        for (const koe of items(suoritus.osasuoritukset)) {
          if (!isCompleted(koe)) continue
          out.push(matriculationTestRecord(ctx, koe, institution, awardedOn))
        }
      }
      continue
    }

    for (const suoritus of items(opiskeluoikeus.suoritukset)) {
      const isDegree = suoritus.tyyppi?.koodiarvo === 'korkeakoulututkinto'

      if (isDegree) {
        if (isCompleted(suoritus)) {
          out.push(degreeRecord(ctx, suoritus, opiskeluoikeus))
        }
        const programmeName = nonEmpty(pick(suoritus.koulutusmoduuli?.virtaNimi))
        for (const osasuoritus of items(suoritus.osasuoritukset)) {
          if (!isCompleted(osasuoritus)) continue
          out.push(
            courseRecord(ctx, osasuoritus, {
              institution: opiskeluoikeus.oppilaitos,
              fieldOfStudy: programmeName,
              programmeContext: programmeName,
              parent: suoritus,
            })
          )
        }
      } else {
        const suoritusName = nonEmpty(pick(suoritus.koulutusmoduuli?.tunniste?.nimi))
        for (const osasuoritus of items(suoritus.osasuoritukset)) {
          if (!isCompleted(osasuoritus)) continue
          out.push(
            courseRecord(ctx, osasuoritus, {
              institution: opiskeluoikeus.oppilaitos,
              // The grade year or syllabus, so that a subject in grade 8 and
              // the same subject in the final syllabus read differently.
              programmeContext: suoritusName,
              parent: suoritus,
            })
          )
        }
      }
    }
  }

  return out.filter(Boolean)
}
