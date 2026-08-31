import { createHash } from 'node:crypto'

const LANGS = ['en', 'fi', 'sv']
const ID_NS = 'urn:opintopolku2openbadge'

// Finnish matriculation examination grade scale, worst to best.
const YO_GRADE_SCALE = ['I', 'A', 'B', 'C', 'M', 'E', 'L']

// Virta study-right type code -> OB3 achievementType for a completed degree.
const DEGREE_ACHIEVEMENT_TYPE = {
  1: 'BachelorDegree',
  3: 'MasterDegree',
}

function pickLang(langMap, langs) {
  if (!langMap) return undefined
  for (const lang of langs) {
    if (langMap[lang]) return langMap[lang]
  }
  return Object.values(langMap)[0]
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
    id: org.oid ? `urn:oid:${org.oid}` : hashId(['org', canonicalName(org.nimi)]),
    type: ['Profile'],
    name: pick(org.nimi),
  }
}

function acceptedAssessment(arviointi) {
  return arviointi?.find((a) => a.hyväksytty) ?? null
}

function gradeResultSpec(arvosana, pick) {
  if (!arvosana) return null
  const koodi = arvosana.koodiarvo
  if (koodi === 'HYV') {
    return { resultType: 'Status', status: 'Completed' }
  }
  if (/^[0-5]$/.test(koodi)) {
    return { resultType: 'RawScore', value: koodi, valueMin: '0', valueMax: '5' }
  }
  if (YO_GRADE_SCALE.includes(koodi)) {
    return { resultType: 'LetterGrade', value: koodi, allowedValue: YO_GRADE_SCALE }
  }
  return { resultType: 'LetterGrade', value: pick(arvosana.nimi) }
}

function buildResults(achievementId, { grade, laajuus }) {
  const resultDescriptions = []
  const results = []

  if (grade) {
    const id = `${achievementId}#grade`
    resultDescriptions.push({
      id,
      type: ['ResultDescription'],
      name: 'Grade',
      resultType: grade.resultType,
      allowedValue: grade.allowedValue,
      valueMin: grade.valueMin,
      valueMax: grade.valueMax,
    })
    results.push({ type: ['Result'], resultDescription: id, value: grade.value, status: grade.status })
  }

  if (laajuus?.arvo != null) {
    const id = `${achievementId}#credits`
    resultDescriptions.push({
      id,
      type: ['ResultDescription'],
      name: 'Extent (ECTS credits)',
      resultType: 'RawScore',
      valueMin: '0',
    })
    results.push({ type: ['Result'], resultDescription: id, value: String(laajuus.arvo) })
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
  }
) {
  const achievementId = hashId(idParts)
  const { resultDescriptions, results } = buildResults(achievementId, { grade, laajuus })

  return compact({
    credentialSubject: {
      type: ['AchievementSubject'],
      id: subjectId,
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
        resultDescriptions: resultDescriptions.length ? resultDescriptions : undefined,
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

function moduleName(km, pick) {
  return pick(km.tunniste?.nimi) ?? pick(km.nimi)
}

function courseRecord({ subjectId, pick }, osasuoritus, { institution, fieldOfStudy, programmeContext }) {
  const km = osasuoritus.koulutusmoduuli
  const name = moduleName(km, pick)
  const creatorOrg = osasuoritus.vahvistus?.myöntäjäOrganisaatio ?? osasuoritus.toimipiste ?? institution
  const institutionName = pick(creatorOrg?.nimi)
  const date = osasuoritus.vahvistus?.päivä
  const accepted = acceptedAssessment(osasuoritus.arviointi)

  const description = programmeContext
    ? `${name}, part of ${programmeContext} at ${institutionName}. Completed ${date}.`
    : `${name}, completed at ${institutionName} on ${date}.`

  return buildRecord(pick, {
    subjectId,
    idParts: [creatorOrg?.oid ?? canonicalName(creatorOrg?.nimi), km.tunniste?.koodiarvo, date],
    achievementType: 'Course',
    name,
    description,
    criteriaNarrative: `Awarded upon successful completion of the course "${name}" at ${institutionName}, as recorded in the Finnish national education data registry (Koski).`,
    creatorOrg,
    fieldOfStudy,
    humanCode: km.tunniste?.koodiarvo,
    grade: gradeResultSpec(accepted?.arvosana, pick),
    laajuus: km.laajuus,
    awardedOn: date,
  })
}

function degreeRecord({ subjectId, pick }, suoritus, opiskeluoikeus) {
  const km = suoritus.koulutusmoduuli
  const name = pick(km.tunniste?.nimi)
  const programmeName = pick(km.virtaNimi)
  const institution = suoritus.vahvistus?.myöntäjäOrganisaatio ?? opiskeluoikeus.oppilaitos
  const institutionName = pick(institution?.nimi)
  const date = suoritus.vahvistus?.päivä
  const virtaCode = opiskeluoikeus.lisätiedot?.virtaOpiskeluoikeudenTyyppi?.koodiarvo
  const achievementType = DEGREE_ACHIEVEMENT_TYPE[virtaCode] ?? 'Degree'

  return buildRecord(pick, {
    subjectId,
    idParts: [opiskeluoikeus.lähdejärjestelmänId?.id, km.tunniste?.koodiarvo, date],
    achievementType,
    name,
    description: `${name}${programmeName ? ` (${programmeName})` : ''}, awarded by ${institutionName} on ${date}.`,
    criteriaNarrative: `Awarded upon successful completion of the ${programmeName ?? name} degree programme at ${institutionName}, as recorded in the Finnish national education data registry (Koski).`,
    creatorOrg: institution,
    fieldOfStudy: programmeName,
    grade: gradeResultSpec(acceptedAssessment(suoritus.arviointi)?.arvosana, pick),
    awardedOn: date,
  })
}

function matriculationExamRecord({ subjectId, pick }, suoritus, opiskeluoikeus) {
  const institution = suoritus.vahvistus?.myöntäjäOrganisaatio ?? suoritus.toimipiste ?? opiskeluoikeus.koulutustoimija
  const institutionName = pick(institution?.nimi)
  const date = suoritus.vahvistus?.päivä

  return buildRecord(pick, {
    subjectId,
    idParts: ['ylioppilastutkinto', institution?.oid, date],
    achievementType: 'SecondarySchoolDiploma',
    name: pick(suoritus.koulutusmoduuli.tunniste.nimi),
    description: `Finnish Matriculation Examination, confirmed by ${institutionName} on ${date}.`,
    criteriaNarrative:
      'Awarded upon passing the required tests of the Finnish Matriculation Examination, as recorded by the Matriculation Examination Board (Ylioppilastutkintolautakunta).',
    creatorOrg: institution,
    awardedOn: date,
  })
}

function matriculationTestRecord({ subjectId, pick }, koe, institution, awardedOn) {
  const km = koe.koulutusmoduuli
  const name = pick(km.tunniste.nimi)
  const session = koe.tutkintokerta
  const sessionLabel = session ? `${pick(session.vuodenaika)} ${session.vuosi}` : undefined
  const accepted = acceptedAssessment(koe.arviointi)

  return buildRecord(pick, {
    subjectId,
    idParts: ['yo-koe', km.tunniste.koodiarvo, session?.koodiarvo],
    achievementType: 'Assessment',
    name,
    description: `${name} test of the Finnish Matriculation Examination${sessionLabel ? `, ${sessionLabel}` : ''}.`,
    criteriaNarrative: `Awarded upon passing the "${name}" test of the Finnish Matriculation Examination.`,
    creatorOrg: institution,
    humanCode: km.tunniste.koodiarvo,
    grade: gradeResultSpec(accepted?.arvosana, pick),
    // Individual exam tests have no vahvistus of their own; fall back to the
    // confirmation date of the enclosing matriculation exam record.
    awardedOn,
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
 *   "en"); falls back through the other available languages per field. Call
 *   `convert` once per language if multiple language versions are needed.
 */
export function convert(data, { lang } = {}) {
  const langs = lang ? [lang, ...LANGS.filter((l) => l !== lang)] : LANGS
  const pick = (langMap) => pickLang(langMap, langs)
  const ctx = { subjectId: `urn:oid:${data.henkilö.oid}`, pick }
  const out = []

  for (const opiskeluoikeus of data.opiskeluoikeudet ?? []) {
    if (opiskeluoikeus.tyyppi?.koodiarvo === 'ylioppilastutkinto') {
      for (const suoritus of opiskeluoikeus.suoritukset ?? []) {
        if (!isCompleted(suoritus)) continue
        out.push(matriculationExamRecord(ctx, suoritus, opiskeluoikeus))

        const institution = suoritus.vahvistus?.myöntäjäOrganisaatio ?? suoritus.toimipiste
        const awardedOn = suoritus.vahvistus?.päivä
        for (const koe of suoritus.osasuoritukset ?? []) {
          if (!isCompleted(koe)) continue
          out.push(matriculationTestRecord(ctx, koe, institution, awardedOn))
        }
      }
      continue
    }

    for (const suoritus of opiskeluoikeus.suoritukset ?? []) {
      const isDegree = suoritus.tyyppi?.koodiarvo === 'korkeakoulututkinto'

      if (isDegree) {
        if (isCompleted(suoritus)) {
          out.push(degreeRecord(ctx, suoritus, opiskeluoikeus))
        }
        const programmeName = pick(suoritus.koulutusmoduuli.virtaNimi)
        for (const osasuoritus of suoritus.osasuoritukset ?? []) {
          if (!isCompleted(osasuoritus)) continue
          out.push(
            courseRecord(ctx, osasuoritus, {
              institution: opiskeluoikeus.oppilaitos,
              fieldOfStudy: programmeName,
              programmeContext: programmeName,
            })
          )
        }
      } else {
        for (const osasuoritus of suoritus.osasuoritukset ?? []) {
          if (!isCompleted(osasuoritus)) continue
          out.push(
            courseRecord(ctx, osasuoritus, {
              institution: opiskeluoikeus.oppilaitos,
            })
          )
        }
      }
    }
  }

  return out
}

export default { convert }
