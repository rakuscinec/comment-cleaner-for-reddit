# Reddit Cleaner

Rozšírenie pre Brave/Chrome (Manifest V3), ktoré načíta všetky tvoje Reddit posty a komentáre,
umožní ich zoradiť a vybrať podľa dátumu a hromadne ich **prepíše** a následne **zmaže**.

## Ako to funguje

- UI beží ako samostatná stránka rozšírenia otvorená v novom tabe (nie popup, nie panel v stránke).
- Na pozadí si udržiava jednu tichú kartu na `old.reddit.com`, cez ktorú volá oficiálne, no
  needokumentované JSON API Reddit-u (`/user/<meno>/overview.json`, `/api/editusertext`,
  `/api/del`) s tvojím prihlásením (cookies), presne tak, ako to robia webové stránky Redditu
  samotné.
- V pravom hornom rohu je tlačidlo s menom aktuálneho účtu (alebo „Neprihlásený“) – kliknutím sa
  otvorí zoznam uložených účtov a možnosť „+ Prihlásiť nový účet“.

## Viac účtov (prepínanie bez odhlasovania)

Reddit session je technicky viazaná na cookies pre `reddit.com` v danom prehliadačovom profile –
extension preto pri pridaní účtu zachytí jeho cookies a uloží ich lokálne (`chrome.storage.local`,
len v tvojom prehliadači). Pri prepnutí účtu potom staré cookies vymaže a nahradí uloženými pre
zvolený účet – žiadne inkognito okná ani manuálne odhlasovanie netreba.

1. Klikni na tlačidlo s menom účtu (vpravo hore) → „+ Prihlásiť nový účet“.
2. Otvorí sa nová karta na prihlásenie na Reddit — prihlás sa tam bežne (heslo zadávaš priamo na
   reddit.com, nikdy nie do rozšírenia). Extension prihlásenie automaticky rozpozná (kontroluje
   každé 2 sekundy), kartu potom sama zatvorí a účet uloží do zoznamu.
3. Pre ďalší účet zopakuj krok 1–2 (medzitým sa vždy najprv odhlás z pôvodného účtu na Reddite
   priamo v tej prihlasovacej karte, aby sa zachytil naozaj nový účet).
4. Kedykoľvek neskôr prepneš účet jednoducho kliknutím na jeho meno v zozname — extension prehodí
   cookies a znova načíta identitu.

**Dôležité:** prepnutie účtu mení Reddit prihlásenie pre **celý prehliadač** (daný profil/okno),
nielen v rámci rozšírenia — ak máš inde otvorenú kartu s reddit.com, aj tá sa po prepnutí bude
tváriť ako prihlásená pod novo zvoleným účtom.

## Inštalácia (Brave aj Chrome)

1. Otvor `brave://extensions` (alebo `chrome://extensions`).
2. Zapni „Developer mode“ / „Režim vývojára“ (vpravo hore).
3. Klikni „Load unpacked“ / „Načítať rozbalené“ a vyber tento priečinok
   (`reddit-cleaner-extension`).
4. Klikni na ikonu rozšírenia v paneli nástrojov – otvorí sa nová karta s aplikáciou.

## Použitie

1. Vyber/prihlás účet vpravo hore (pozri „Viac účtov“) a klikni
   „Načítať moje posty a komentáre“.
2. Zoraď podľa dátumu, vyber položky pomocou:
   - rýchlych tlačidiel (staršie ako hodina / deň / týždeň / mesiac),
   - „Posledných N položiek“,
   - dátumového rozsahu od–do,
   - „Invertovať výber“,
   - alebo ručne cez checkboxy / „Vybrať všetko“.
3. Priprav si text, ktorým sa má obsah prepísať (predvolené `.`).
4. Klikni „Prepísať a zmazať vybrané“ a potvrď v dialógu.
5. Rozšírenie postupne (s pauzami kvôli rate-limitom Redditu) prepíše a zmaže vybrané položky
   a loguje priebeh dole na stránke.

## Dôležité upozornenia

- **Nevratné.** Po prepísaní a zmazaní sa pôvodný obsah nedá obnoviť.
- **Linkové/obrázkové posty**: Reddit API neumožňuje upraviť telo/titulok takéhoto postu, takže
  sa iba rovno zmaže (bez prepísania) – rozšírenie to označí v logu.
- **Rate limity**: medzi jednotlivými akciami sú úmyselné pauzy (~1 s). Pri stovkách položiek to
  môže trvať dlhšie – nechaj kartu otvorenú a nezatváraj tichý tab na `old.reddit.com`.
- Ide o neoficiálne (ale bežne používané, napr. podobnými open-source nástrojmi) využitie
  verejného Reddit JSON API cez tvoje vlastné prihlásenie. Reddit môže správanie API kedykoľvek
  zmeniť, čím sa nástroj môže rozbiť.
- Odporúčam prvé použitie vyskúšať na malej vzorke (napr. 2–3 staré komentáre) pred hromadným
  mazaním.
- **Uložené cookies účtov** obsahujú prihlasovacie session tokeny — sú uložené len lokálne v
  `chrome.storage.local` tohto rozšírenia (nikam sa neposielajú), ale kto má prístup k tvojmu
  prehliadaču/profilu, má tým pádom prístup aj k prihláseniu na uložené účty. Na zdieľanom
  počítači zváž po použití účty needostupné (napr. cez „Log out“ priamo na Reddite).
