# Opiskelijatodiste: miten opiskelijastatus päätellään Koski-tiedoista

Tämä dokumentti kertoo, milloin koski2openbadge tekee henkilön Koski-tiedoista opiskelijatodisteen ja mitä
todiste silloin sisältää. Säännöt ovat samat kuin koodissa (`index.js`, funktio `studentStatusRecord`).

## Mitä opiskelijatodiste kertoo

Opiskelijatodiste kertoo, että **Koski-tietovarannon mukaan henkilö oli tiettynä päivänä läsnä oleva opiskelija**
tietyssä oppilaitoksessa ja millä koulutusasteella hän opiskeli. Todisteesta näkyy myös, mihin asti se on voimassa.

Todiste on tilannekuva. Se ei kerro, että henkilö opiskelee yhä, jos tilanne on muuttunut tarkasteluhetken
jälkeen. Siksi todisteeseen kirjataan päivä, jonka tilanteesta se kertoo, ja voimassaolo päättyy viimeistään
opintojen arvioituun päättymiseen.

Todisteen tarkastaja päättää itse, kelpaako todiste hänen tarkoitukseensa. Esimerkiksi opiskelija-alennuksen
myöntäjä voi hyväksyä lukiolaisen tai vain korkeakouluopiskelijan. Tätä varten todisteessa on koulutusaste ja
opiskeluoikeuden tyyppi myös koneluettavina koodeina.

## Lähtötiedot

Päättely tehdään henkilön Koski-tiedoista (Oma Opintopolun jakolinkin tai Koski-rajapinnan JSON). Jokainen
opiskeluoikeus (`opiskeluoikeudet[]`) käsitellään erikseen, ja jokainen ehdot täyttävä opiskeluoikeus antaa oman
todisteen. Esimerkiksi henkilö, joka opiskelee samaan aikaan lukiossa ja ammattikoulussa, saa kaksi todistetta.

Tarkasteluhetki on muunnoksen `asOf`-parametri (oletuksena muunnoshetki). Ratkaiseva on sen kalenteripäivä Suomen
aikaa. Opintotodiste-palvelu hakee tiedot Koskesta uudelleen aina, kun opiskelijatodiste allekirjoitetaan tai
lisätään lompakkoon, joten tarkasteluhetki on allekirjoitushetki.

Opiskeluoikeudesta käytetään näitä tietoja:

| Koski-tieto | Käyttö |
|---|---|
| `tyyppi` (koodisto `opiskeluoikeudentyyppi`) | rajaus, koulutusmuoto |
| `alkamispäivä`, `päättymispäivä` | onko opiskeluoikeus voimassa |
| `arvioituPäättymispäivä` | voimassaolon päättyminen |
| `tila.opiskeluoikeusjaksot` | onko henkilö läsnä |
| `lisätiedot.lukukausiIlmoittautuminen` | korkeakouluissa: onko henkilö ilmoittautunut läsnä olevaksi |
| `lisätiedot.virtaOpiskeluoikeudenTyyppi` | korkeakouluissa: opiskeluoikeuden tyyppi Virrassa |
| `oppilaitos` (tai `koulutustoimija`) | oppilaitoksen nimi, OID ja oppilaitosnumero |
| `suoritukset[].koulutusmoduuli.tunniste` | koulutuskoodi, josta koulutusaste päätellään, ja koulutuksen nimi |

Mikä tahansa tieto voi puuttua. Jos jokin ehtojen tarvitsema tieto puuttuu, todistetta ei tehdä. Jos jokin
sisältöön kuuluva tieto puuttuu, se jätetään todisteesta pois.

## Ehdot

Opiskeluoikeudesta tehdään opiskelijatodiste vain, jos **kaikki** seuraavat ehdot täyttyvät tarkastelupäivänä.

### 1. Opiskeluoikeuden tyyppi antaa opiskelijastatuksen

Nämä opiskeluoikeuden tyypit eivät koskaan anna opiskelijatodistetta:

| Tyyppi | Miksi ei |
|---|---|
| `esiopetus` | esiopetus ja perusopetus ovat lapsen koulunkäyntiä, eivät opiskelijastatusta |
| `perusopetus`, `aikuistenperusopetus`, `ahvenanmaanperusopetus` | samoin |
| `perusopetukseenvalmistavaopetus`, `perusopetuksenlisaopetus` | perusopetukseen kuuluvaa opetusta |
| `taiteenperusopetus` | harrastus |
| `ylioppilastutkinto`, `kielitutkinto` | tutkintoja eli kokeita, eivät opintoja |

Kaikki muut tyypit (esimerkiksi `lukiokoulutus`, `ammatillinenkoulutus`, `tuva`, `korkeakoulutus`) voivat antaa
todisteen. Jos tyyppi puuttuu, todistetta ei tehdä.

### 2. Opiskeluoikeus on alkanut eikä ole päättynyt

- `alkamispäivä` on viimeistään tarkastelupäivänä (tai puuttuu), ja
- `päättymispäivä` on aikaisintaan tarkastelupäivänä (tai puuttuu).

### 3. Viimeisin alkanut tilajakso on läsnä

Tilajaksoista (`tila.opiskeluoikeusjaksot`) otetaan se, joka on alkanut viimeisimpänä tarkastelupäivään mennessä.
Sen tilan on oltava:

- Koskeen kirjatuissa opiskeluoikeuksissa (koodisto `koskiopiskeluoikeudentila`): `lasna` (läsnä).
- Virrasta tulevissa korkeakoulujen opiskeluoikeuksissa (koodisto `virtaopiskeluoikeudentila`): `1` (aktiivinen).

Jos jaksolla ei ole koodistoa, korkeakoulutuksessa käytetään Virran koodistoa ja muuten Kosken koodistoa.

Mikään muu tila ei riitä. Erityisesti **väliaikaisesti keskeytynyt** (`valiaikaisestikeskeytynyt`) ja **loma**
(`loma`) eivät anna todistetta, koska henkilö ei silloin opiskele. Opiskeluoikeus, jolla ei ole yhtään alkanutta
tilajaksoa, ei anna todistetta.

### 4. Korkeakouluissa: ilmoittautunut läsnä olevaksi

Korkeakoulutuksessa (`korkeakoulutus`) Virran tila on usein `aktiivinen` myös silloin, kun henkilö ei opiskele.
Esimerkkejä ovat avoimen yliopiston ja erillisen opiskeluoikeuden opiskelijat sekä poissa olevaksi ilmoittautuneet.
Siksi tarvitaan lisäksi lukukausi-ilmoittautuminen:

- Tarkastelupäivän on osuttava sellaisen jakson sisään (`lisätiedot.lukukausiIlmoittautuminen.ilmoittautumisjaksot`,
  `alku`–`loppu`), ja
- jakson tilan on oltava `1` (läsnä, koodisto `virtalukukausiilmtila`).

Poissa oleva ilmoittautuminen, puuttuva ilmoittautuminen ("Puuttuu") tai ilmoittautumisen puuttuminen kokonaan ei
anna todistetta. Tämä vastaa sitä, ketkä saavat korkeakouluissa opiskelijaetuja.

### 5. Voimassaololle on päättymispäivä

Voimassaolon viimeinen päivä on aikaisin näistä:

- opiskeluoikeuden arvioitu päättymispäivä (`arvioituPäättymispäivä`)
- opiskeluoikeuden päättymispäivä (`päättymispäivä`)
- korkeakouluissa ehdon 4 lukukausi-ilmoittautumisen loppupäivä (`loppu`)

Jos mitään näistä ei ole, **todistetta ei tehdä**, koska ilman päättymistä todiste olisi voimassa ikuisesti.
Virrasta tulevilla opiskeluoikeuksilla on harvoin arvioitu päättymispäivä, joten korkeakouluopiskelijan todiste
on yleensä voimassa kuluvan lukukauden loppuun.

Todiste on voimassa päättymispäivän loppuun Suomen aikaa (klo 23.59.59).

## Mitä todisteeseen tulee

Todiste on Open Badges 3.0 -muotoinen (`achievementType: "ext:StudentStatus"`, tulos `status: "Enrolled"`).
Opintotodiste-palvelu lähettää sen lompakkoon myös omana tyyppinään (SD-JWT VC "Opiskelijatodiste", ks.
[openbadge-vct](https://github.com/FindyFi/openbadge-vct)). Sisältö on molemmissa sama:

| Sisältö | Mistä |
|---|---|
| Oppilaitos | `oppilaitos.nimi` (tai `koulutustoimija`), tunnisteena `urn:oid:` + oppilaitoksen OID |
| Oppilaitosnumero | `oppilaitos.oppilaitosnumero` (Tilastokeskuksen viisinumeroinen oppilaitosnumero), jos Koskessa on |
| Taso nimessä | "Opiskelija: …" ja perään korkeakouluissa Virran opiskeluoikeuden tyypin nimi (esim. "Ylempi korkeakoulututkinto"), muuten opiskeluoikeuden tyypin nimi (esim. "Lukiokoulutus") |
| Koulutusmuoto | opiskeluoikeuden tyyppi koodina ja nimenä (koodisto `opiskeluoikeudentyyppi`) |
| Virran opiskeluoikeuden tyyppi | korkeakouluissa koodina ja nimenä (koodisto `virtaopiskeluoikeudentyyppi`), jos Virrassa on |
| Koulutusaste | koulutuskoodin ensimmäinen numero (ks. alla), jos koulutuskoodi on |
| Koulutus | koulutuskoodin nimi (esim. "Lukion oppimäärä"), jos on |
| Opinnot alkaneet | `alkamispäivä` |
| Tilanne päivältä | tarkastelupäivä |
| Voimassa asti | ehdon 5 päivä |

Henkilön nimi ja oppijanumero tulevat todisteeseen samoin kuin muihinkin osaamismerkkeihin.

### Koulutusaste

Koulutusaste päätellään opiskeluoikeuden ensimmäisestä suorituksesta, jolla on kuusinumeroinen koulutuskoodi
(koodisto `koulutus`). Koodin ensimmäinen numero on Tilastokeskuksen koulutusluokituksen 2016 koulutusaste
(koodisto `kansallinenkoulutusluokitus2016koulutusastetaso1`), joka noudattaa ISCED 2011 -tasoja:

| Koodi | Koulutusaste |
|---|---|
| 0 | Varhaiskasvatus ja esiopetusaste |
| 1 | Alempi perusaste |
| 2 | Ylempi perusaste |
| 3 | Toinen aste |
| 4 | Erikoisammattikoulutusaste |
| 5 | Alin korkea-aste |
| 6 | Alempi korkeakouluaste |
| 7 | Ylempi korkeakouluaste |
| 8 | Tutkijakoulutusaste |

Koodi 9 (tuntematon) jätetään pois. Koulutusaste puuttuu myös silloin, kun opiskeluoikeudella ei ole
koulutuskoodia. Näin on esimerkiksi avoimen yliopiston ja erillisten opiskeluoikeuksien kohdalla, joiden
tunnisteena on Virran tyyppi. Ne eivät yleensä täytä ehtoa 4, joten käytännössä tämä harvoin vaikuttaa.

ISCED- ja EQF-tasoja ei käytetä, koska Koski ei liitä niitä kaikkiin koulutuskoodeihin. Esimerkiksi lukion
oppimäärällä niitä ei ole.

## Esimerkkejä

Kuvitteellisia tapauksia, tarkastelupäivä 20.10.2026:

| Tapaus | Todiste? | Miksi |
|---|---|---|
| Lukio, tila `lasna` 8.8.2024 alkaen, arvioitu päättyminen 5.6.2027 | **kyllä**, voimassa 5.6.2027 asti, Toinen aste | ehdot täyttyvät |
| Sama lukio, viimeisin tila `valiaikaisestikeskeytynyt` 1.9.2026 alkaen | ei | ehto 3 |
| Ammatillinen koulutus, `lasna`, ei arvioitua päättymispäivää eikä päättymispäivää | ei | ehto 5 |
| Yliopisto, tila `1` (aktiivinen), syyslukukausi 1.8.–31.12.2026 läsnä | **kyllä**, voimassa 31.12.2026 asti | ehdot täyttyvät |
| Yliopisto, tila `1`, syyslukukausi poissa | ei | ehto 4 |
| Avoin yliopisto, tila `1`, ilmoittautuminen "Puuttuu" | ei | ehto 4 |
| Erillinen opiskeluoikeus päättynyt 1.1.2026, kevään 2026 ilmoittautumisrivi | ei | ehto 2 |
| Perusopetus, `lasna` | ei | ehto 1 |
| Tutkinto valmistunut (`valmistunut`, päättymispäivä ennen tarkastelupäivää) | ei | ehdot 2 ja 3 |

## Rajoitukset

- **Tiedot ovat niin ajantasaisia kuin Koski.** Oppilaitokset kirjaavat tiedot Koskeen, ja kirjauksissa voi olla
  viivettä. Jos tieto on väärin, sen voi korjata vain oppilaitos.
- **Todistetta ei peruuteta.** Opiskelijakortin tapaan todiste on voimassa päättymispäivään asti, vaikka henkilö
  lopettaisi opintonsa sitä ennen. "Tilanne päivältä" kertoo, minkä päivän tilanteesta todiste on.
- **Opintojen normiaikaa ei käytetä.** Jos arvioitua päättymispäivää ei ole, voimassaoloa ei arvata tutkinnon
  laajuudesta.
- **Henkilöllisyyttä ei tarkasteta.** Todiste kertoo, mitä Koskessa lukee siitä henkilöstä, jonka tiedot jaettiin.
  Tarkastaja voi verrata todisteen nimeä henkilöllisyystodistukseen tai henkilötunnistetietoihin (PID).
