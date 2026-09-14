# koski2openbadge

Converts study records exported from [Koski](https://koski.opintopolku.fi/koski/) (Oma Koski, the Finnish national
education data registry) into [Open Badges 3.0](https://1edtech.github.io/openbadges-specification/ob_v3p0.html)
achievement data.

## Install

```sh
npm install
```

The package has no runtime dependencies; it only uses Node's built-in `node:crypto`.

## Usage

```js
import { convert } from './index.js'
import data from './opintopolku.json' with { type: 'json' }

const records = convert(data, { lang: 'fi' })
```

`opintopolku.json` in this repo is a sample Koski export you can use to try the converter out.

### `convert(data, options?)`

Converts a Koski/Opintopolku study record export into an array of `{ credentialSubject, awardedOn }` items:

- `credentialSubject` is a spec-shaped Open Badges 3.0 `AchievementSubject`.
- `awardedOn` is a plain ISO date fact, left for the calling issuer component to place wherever its target VC Data
  Model version expects it (e.g. `validFrom` or `issuanceDate`).

The converter itself does not issue or sign credentials — it only produces the achievement data to embed in one.

Recognised study records include:

- Completed courses and their grades/credits (`koulutusmoduuli` sub-achievements)
- Completed degrees (bachelor's/master's), mapped to the corresponding Open Badges `achievementType`
- The Finnish matriculation examination (ylioppilastutkinto) and its individual subject tests

Options:

- `lang` — preferred output language (`"fi"`, `"sv"`, or `"en"`). Falls back through the other available languages
  per field if the preferred one is missing, and also selects the language of text the converter itself generates
  (descriptions, criteria narratives, result names). Defaults to `"en"`. Call `convert` once per language if
  multiple language versions are needed.

## License

Apache-2.0
