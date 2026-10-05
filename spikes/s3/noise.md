# B1 noise evaluation (hand-checked list, `noise.json`)

Visible noise occurrences per output (kinds ui/meta/promo). Hidden = items hidden by site CSS (a Chrome visibility check would drop them; jsdom cannot). Glyph = letterless permalink anchors.

| fixture | generator | R visible | W visible | R+G+S visible | W+G visible | W+G+S visible | W hidden | W glyph | W+G+S hidden |
|---|---|---|---|---|---|---|---|---|---|
| docusaurus-code-blocks | Docusaurus | 0 | 20 | 0 | 20 | 0 | 0 | 17 | 0 |
| mkdocs-material-admonitions | – | 0 | 0 | 0 | 0 | 0 | 0 | 14 | 0 |
| mdn-promise-then | MDN | 1 | 13 | 0 | 13 | 0 | 0 | 0 | 0 |
| docsrs-tokio | rustdoc | 1 | 5 | 0 | 5 | 0 | 0 | 18 | 0 |
| github-readme-bat | – | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| wikipedia-futures-promises | MediaWiki | 16 | 31 | 0 | 12 | 0 | 13 | 100 | 1 |
| mdbook-rust-book-ownership | – | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| goblog-pipelines | GoDev | 0 | 4 | 0 | 4 | 1 | 0 | 10 | 0 |
| twir-671 | – | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| globalvoices-bangladesh-protests | WordPress | 0 | 50 | 0 | 50 | 0 | 0 | 0 | 0 |
| **sites with 0 visible noise** | | **7/10** | **4/10** | **10/10** | **4/10** | **9/10** | | | |

Upper bound (whole-word substring of the output text, visible kinds; may over-count short items that are also ordinary words):

| fixture | R | W | R+G+S | W+G | W+G+S |
|---|---|---|---|---|---|
| docusaurus-code-blocks | 0 | 20 | 0 | 20 | 0 |
| mkdocs-material-admonitions | 0 | 0 | 0 | 0 | 0 |
| mdn-promise-then | 1 | 13 | 0 | 13 | 0 |
| docsrs-tokio | 1 | 5 | 0 | 5 | 0 |
| github-readme-bat | 0 | 0 | 0 | 0 | 0 |
| wikipedia-futures-promises | 16 | 31 | 0 | 12 | 0 |
| mdbook-rust-book-ownership | 0 | 0 | 0 | 0 | 0 |
| goblog-pipelines | 0 | 4 | 0 | 4 | 1 |
| twir-671 | 0 | 0 | 0 | 0 | 0 |
| globalvoices-bangladesh-protests | 7 | 63 | 7 | 63 | 10 |
| **sites with 0** | **6/10** | **4/10** | **9/10** | **4/10** | **8/10** |

Noise share of output chars (visible kinds):

| fixture | R | W | R+G+S | W+G | W+G+S |
|---|---|---|---|---|---|
| docusaurus-code-blocks | 0.00% | 1.74% | 0.00% | 1.75% | 0.00% |
| mkdocs-material-admonitions | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% |
| mdn-promise-then | 0.26% | 3.57% | 0.00% | 3.58% | 0.00% |
| docsrs-tokio | 0.13% | 0.29% | 0.00% | 0.29% | 0.00% |
| github-readme-bat | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% |
| wikipedia-futures-promises | 0.48% | 1.07% | 0.00% | 0.60% | 0.00% |
| mdbook-rust-book-ownership | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% |
| goblog-pipelines | 0.00% | 0.29% | 0.00% | 0.29% | 0.06% |
| twir-671 | 0.00% | 0.00% | 0.00% | 0.00% | 0.00% |
| globalvoices-bangladesh-protests | 0.00% | 14.56% | 0.00% | 14.56% | 0.00% |

Content blocks kept (truth leaf blocks ≥ 15 chars, labelled noise excluded, found in the output text) and `pre` kept, to check that the selectors don't remove content:

| fixture | R recall / pre | W recall / pre | R+G+S recall / pre | W+G recall / pre | W+G+S recall / pre |
|---|---|---|---|---|---|
| docusaurus-code-blocks | 91% / 40/59 | 100% / 59/59 | 91% / 40/59 | 100% / 59/59 | 100% / 59/59 |
| mkdocs-material-admonitions | 100% / 17/17 | 100% / 17/17 | 100% / 17/17 | 100% / 17/17 | 100% / 17/17 |
| mdn-promise-then | 93% / 12/12 | 100% / 12/12 | 93% / 12/12 | 100% / 12/12 | 100% / 12/12 |
| docsrs-tokio | 98% / 8/8 | 100% / 8/8 | 98% / 8/8 | 100% / 8/8 | 100% / 8/8 |
| github-readme-bat | 100% / 58/58 | 100% / 58/58 | 100% / 58/58 | 100% / 58/58 | 100% / 58/58 |
| wikipedia-futures-promises | 99% / 4/4 | 100% / 4/4 | 100% / 4/4 | 100% / 4/4 | 100% / 4/4 |
| mdbook-rust-book-ownership | 99% / 15/15 | 100% / 15/15 | 99% / 15/15 | 100% / 15/15 | 100% / 15/15 |
| goblog-pipelines | 97% / 9/26 | 100% / 26/26 | 97% / 9/26 | 100% / 26/26 | 100% / 26/26 |
| twir-671 | 99% / 0/0 | 100% / 0/0 | 99% / 0/0 | 100% / 0/0 | 100% / 0/0 |
| globalvoices-bangladesh-protests | 100% / 0/0 | 100% / 0/0 | 100% / 0/0 | 100% / 0/0 | 100% / 0/0 |

Items left per output:

- **docusaurus-code-blocks**
  - R: —
  - W: Version: 3.10.2; http://localhost:3000 ×13; Live Editor ×3; Result ×3
  - R+G+S: —
  - W+G: Version: 3.10.2; http://localhost:3000 ×13; Live Editor ×3; Result ×3
  - W+G+S: —
- **mkdocs-material-admonitions**
  - R: —
  - W: —
  - R+G+S: —
  - W+G: —
  - W+G+S: —
- **mdn-promise-then**
  - R: Browser compatibility settings
  - W: Baseline Widely available; See full compatibility; Learn more; Report problems with this compatibility data; View data on GitHub; Help improve MDN; Learn how to contribute; MDN contributors; Sep 1, 2026; View this page on GitHub; Report a problem with this content; This feature is well established and works across many devices and browser versions. It’s been available across browsers since July 2015.; This page was last modified on Sep 1, 2026 by MDN contributors .
  - R+G+S: —
  - W+G: Baseline Widely available; See full compatibility; Learn more; Report problems with this compatibility data; View data on GitHub; Help improve MDN; Learn how to contribute; MDN contributors; Sep 1, 2026; View this page on GitHub; Report a problem with this content; This feature is well established and works across many devices and browser versions. It’s been available across browsers since July 2015.; This page was last modified on Sep 1, 2026 by MDN contributors .
  - W+G+S: —
- **docsrs-tokio**
  - R: Expand description
  - W: Search; Settings; Help; Source; Expand description
  - R+G+S: —
  - W+G: Search; Settings; Help; Source; Expand description
  - W+G+S: —
- **github-readme-bat**
  - R: —
  - W: —
  - R+G+S: —
  - W+G: —
  - W+G+S: —
- **wikipedia-futures-promises**
  - R: [ edit ] ×9; Jump up to: ×7
  - W: [ edit ] ×19; Edit links; From Wikipedia, the free encyclopedia; Jump up to: ×7; Categories; Inter-process communication; Actor model (computer science)
  - R+G+S: —
  - W+G: Edit links; From Wikipedia, the free encyclopedia; Jump up to: ×7; Categories; Inter-process communication; Actor model (computer science)
  - W+G+S: —
- **mdbook-rust-book-ownership**
  - R: —
  - W: —
  - R+G+S: —
  - W+G: —
  - W+G+S: —
- **goblog-pipelines**
  - R: —
  - W: The Go Blog; Go talks at FOSDEM 2014; The Go Gopher; Blog Index
  - R+G+S: —
  - W+G: The Go Blog; Go talks at FOSDEM 2014; The Go Gopher; Blog Index
  - W+G+S: The Go Blog
- **twir-671**
  - R: —
  - W: —
  - R+G+S: —
  - W+G: —
  - W+G+S: —
- **globalvoices-bangladesh-protests**
  - R: —
  - W: Read this post in; বাংলা; Categories; Regions; Topics; Breaking News; Censorship; Citizen Media; Digital Activism; Elections; Freedom of Speech; Governance; Human Rights; Media & Journalism; Youth; Protest in democracy; Support our work; Donate now; Recent South Asia Stories; The sound of resistance; Equating protest with terrorism: A narrative against dissent; More »; Top World Stories; 4 days ago ×2; 6 days ago; 1 week ago; 2 days ago; Cancel this reply; Start the conversation; Education; History; Law; Politics; Protest; South Asia; Bangladesh; Beyond protest: Mob violence and the struggle for institutional response in Bangladesh; How a farmers’ protest in Bucharest was inflated online, then hijacked; West-to-east energy, east-to-west computing: The Uyghur costs of China’s digital order; The shock wave of Sister Hong: Catfishing, gender imbalance, and sexual education in China; Written by Sydney Allen , Kevin Rennie , Sanjib Chaudhary , Rai M Azlan , Daria Dergacheva , Jean Sovon , Nurbek Bekmurzaev; Written by Civic Media Observatory , Samanta Azpurua; Written by Maksuda Akter; Written by Guest Contributor; Written by Asiye Uyghur; Written by Jingjing Shueh; 24 July 2025; Global Voices; Please consider making a donation to help us continue this work.
  - R+G+S: —
  - W+G: Read this post in; বাংলা; Categories; Regions; Topics; Breaking News; Censorship; Citizen Media; Digital Activism; Elections; Freedom of Speech; Governance; Human Rights; Media & Journalism; Youth; Protest in democracy; Support our work; Donate now; Recent South Asia Stories; The sound of resistance; Equating protest with terrorism: A narrative against dissent; More »; Top World Stories; 4 days ago ×2; 6 days ago; 1 week ago; 2 days ago; Cancel this reply; Start the conversation; Education; History; Law; Politics; Protest; South Asia; Bangladesh; Beyond protest: Mob violence and the struggle for institutional response in Bangladesh; How a farmers’ protest in Bucharest was inflated online, then hijacked; West-to-east energy, east-to-west computing: The Uyghur costs of China’s digital order; The shock wave of Sister Hong: Catfishing, gender imbalance, and sexual education in China; Written by Sydney Allen , Kevin Rennie , Sanjib Chaudhary , Rai M Azlan , Daria Dergacheva , Jean Sovon , Nurbek Bekmurzaev; Written by Civic Media Observatory , Samanta Azpurua; Written by Maksuda Akter; Written by Guest Contributor; Written by Asiye Uyghur; Written by Jingjing Shueh; 24 July 2025; Global Voices; Please consider making a donation to help us continue this work.
  - W+G+S: —
