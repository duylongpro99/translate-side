# via walk · 335 segments
1oocarcxcjm p /html[1]/body[1]/article[1]/p[1]
  A *cat(1)* clone with syntax highlighting and Git integration.
06bpzmami97 p /html[1]/body[1]/article[1]/p[2]
  [link]Key Features[/link] • [link]How To Use[/link] • [link]Installation[/link] • [link]Customization[/link] • [link]Project goals, alternatives[/link]
  [English] [[link]中文[/link]] [[link]日本語[/link]] [[link]한국어[/link]] [[link]Русский[/link]]
1mgw0bxdigl heading [h3] /html[1]/body[1]/article[1]/div[1]/h3[1]
  Syntax highlighting
0etwop6sgrl p /html[1]/body[1]/article[1]/p[3]
  `bat` supports syntax highlighting for a large number of programming and markup languages:
1atgshul8pq heading [h3] /html[1]/body[1]/article[1]/div[2]/h3[1]
  Git integration
0zt8mw6kbd5 p /html[1]/body[1]/article[1]/p[5]
  `bat` communicates with `git` to show modifications with respect to the index (see left sidebar):
28ikuz9nzr0 heading [h3] /html[1]/body[1]/article[1]/div[3]/h3[1]
  Show non-printable characters
1s5s37s8dmi p /html[1]/body[1]/article[1]/p[7]
  You can use the `-A`/`--show-all` option to show and highlight non-printable characters:
1unaa6t8n33 heading [h3] /html[1]/body[1]/article[1]/div[4]/h3[1]
  Automatic paging
0o5x2rc74gg p /html[1]/body[1]/article[1]/p[9]
  By default, `bat` pipes its own output to a pager (e.g. `less`) if the output is too large for one screen. If you would rather `bat` work like `cat` all the time (never page output), you can set `--paging=never` as an option, either on the command line or in your configuration file. If you intend to alias `cat` to `bat` in your shell configuration, you can use `alias cat='bat --paging=never'` to preserve the default behavior.
0bvxmirpzeu heading [h4] /html[1]/body[1]/article[1]/div[5]/h4[1]
  File concatenation
2a6jn8mq449 p /html[1]/body[1]/article[1]/p[10]
  Even with a pager set, you can still use `bat` to concatenate files 😉. Whenever `bat` detects a non-interactive terminal (i.e. when you pipe into another process or into a file), `bat` will act as a drop-in replacement for `cat` and fall back to printing the plain file contents, regardless of the `--pager` option's value.
21p49kduru1 heading [h2] /html[1]/body[1]/article[1]/div[6]/h2[1]
  How to use
0idirbmszkv p /html[1]/body[1]/article[1]/p[11]
  Display a single file on the terminal
1u1y28sezxl code [no-translate] /html[1]/body[1]/article[1]/div[7]/pre[1]
  bat README.md
0kb6c6053py p /html[1]/body[1]/article[1]/p[12]
  Display multiple files at once
05kgr25cpsc code [no-translate] /html[1]/body[1]/article[1]/div[8]/pre[1]
  bat src/*.rs
0p2nv65v75p p /html[1]/body[1]/article[1]/p[13]
  Read from stdin, determine the syntax automatically (note, highlighting will only work if the syntax can be determined from the first line of the file, usually through a shebang such as `#!/bin/sh`)
1fhs4mwsn6u code [no-translate] /html[1]/body[1]/article[1]/div[9]/pre[1]
  curl -s https://sh.rustup.rs | bat
1kgcqq5q147 p /html[1]/body[1]/article[1]/p[14]
  Read from stdin, specify the language explicitly
28a7ayq34cb code [no-translate] /html[1]/body[1]/article[1]/div[10]/pre[1]
  yaml2json .travis.yml | json_pp | bat -l json
0f9u3dbjb2f p /html[1]/body[1]/article[1]/p[15]
  Show and highlight non-printable characters:
10s01xlgy5j code [no-translate] /html[1]/body[1]/article[1]/div[11]/pre[1]
  bat -A /etc/hosts
1nl1lhx2prk p /html[1]/body[1]/article[1]/p[16]
  Use it as a `cat` replacement:
22r3rnzq81x code [no-translate] /html[1]/body[1]/article[1]/div[12]/pre[1]
  bat > note.md  # quickly create a new file
  
  bat header.md content.md footer.md > document.md
  
  bat -n main.rs  # show line numbers (only)
  
  bat f - g  # output 'f', then stdin, then 'g'.
162sgc4bc7c heading [h3] /html[1]/body[1]/article[1]/div[13]/h3[1]
  Integration with other tools
14txn0pst83 heading [h4] /html[1]/body[1]/article[1]/div[14]/h4[1]
  `fzf`
0zsbopcbw7o p /html[1]/body[1]/article[1]/p[17]
  You can use `bat` as a previewer for [link]`fzf`[/link]. To do this, use `bat`'s `--color=always` option to force colorized output. You can also use `--line-range` option to restrict the load times for long files:
192d8zphlof code [no-translate] /html[1]/body[1]/article[1]/div[15]/pre[1]
  fzf --preview "bat --color=always --style=numbers --line-range=:500 {}"
06j906xq874 p /html[1]/body[1]/article[1]/p[18]
  For more information, see [link]`fzf`'s `README`[/link].
1svocyztagw heading [h4] /html[1]/body[1]/article[1]/div[16]/h4[1]
  `find` or `fd`
045ditjgd8n p /html[1]/body[1]/article[1]/p[19]
  You can use the `-exec` option of `find` to preview all search results with `bat`:
02re9k34oz3 code [no-translate] /html[1]/body[1]/article[1]/div[17]/pre[1]
  find … -exec bat {} +
0pbvbvr3kl5 p /html[1]/body[1]/article[1]/p[20]
  If you happen to use [link]`fd`[/link], you can use the `-X`/`--exec-batch` option to do the same:
1clfm95m1kf code [no-translate] /html[1]/body[1]/article[1]/div[18]/pre[1]
  fd … -X bat
0xjoo20t2kd heading [h4] /html[1]/body[1]/article[1]/div[19]/h4[1]
  `ripgrep`
1yy0n506m1m p /html[1]/body[1]/article[1]/p[21]
  With [link]`batgrep`[/link], `bat` can be used as the printer for [link]`ripgrep`[/link] search results.
0if1njop1g6 code [no-translate] /html[1]/body[1]/article[1]/div[20]/pre[1]
  batgrep needle src/
2d4bvgam4vf heading [h4] /html[1]/body[1]/article[1]/div[21]/h4[1]
  `tail -f`
05vbho8x35b p /html[1]/body[1]/article[1]/p[22]
  `bat` can be combined with `tail -f` to continuously monitor a given file with syntax highlighting.
1jia6clbwjq code [no-translate] /html[1]/body[1]/article[1]/div[22]/pre[1]
  tail -f /var/log/pacman.log | bat --paging=never -l log
0wm52l3fbj2 p /html[1]/body[1]/article[1]/p[23]
  Note that we have to switch off paging in order for this to work. We have also specified the syntax explicitly (`-l log`), as it can not be auto-detected in this case.
0u510irgoxa heading [h4] /html[1]/body[1]/article[1]/div[23]/h4[1]
  `git`
2fn6sm6e9kq p /html[1]/body[1]/article[1]/p[24]
  You can combine `bat` with `git show` to view an older version of a given file with proper syntax highlighting:
0ht5xxsr3ox code [no-translate] /html[1]/body[1]/article[1]/div[24]/pre[1]
  git show v0.6.0:src/main.rs | bat -l rs
10beunqpghy heading [h4] /html[1]/body[1]/article[1]/div[25]/h4[1]
  `git diff`
1y10kl10yce p /html[1]/body[1]/article[1]/p[25]
  You can combine `bat` with `git diff` to view lines around code changes with proper syntax highlighting:
1fds0pi531b code [no-translate] /html[1]/body[1]/article[1]/div[26]/pre[1]
  batdiff() {
      git diff --name-only --relative --diff-filter=d -z | xargs -0 bat --diff
  }
02xwer9770m p /html[1]/body[1]/article[1]/p[26]
  If you prefer to use this as a separate tool, check out `batdiff` in [link]`bat-extras`[/link].
1c8i0owwtzx p /html[1]/body[1]/article[1]/p[27]
  If you are looking for more support for git and diff operations, check out [link]`delta`[/link].
0ugmfjvera2 heading [h4] /html[1]/body[1]/article[1]/div[27]/h4[1]
  `xclip`
1hdwnyqfm85 p /html[1]/body[1]/article[1]/p[28]
  The line numbers and Git modification markers in the output of `bat` can make it hard to copy the contents of a file. To prevent this, you can call `bat` with the `-p`/`--plain` option or simply pipe the output into `xclip`:
0l3ee9g381a code [no-translate] /html[1]/body[1]/article[1]/div[28]/pre[1]
  bat main.cpp | xclip
1xbzns9w0ef p /html[1]/body[1]/article[1]/p[29]
  `bat` will detect that the output is being redirected and print the plain file contents.
1ekzr38708d heading [h4] /html[1]/body[1]/article[1]/div[29]/h4[1]
  `man`
13wfbrgnlss p /html[1]/body[1]/article[1]/p[30]
  `bat` can be used as a colorizing pager for `man`, by setting the `MANPAGER` environment variable:
1x8hn1t30f2 code [no-translate] /html[1]/body[1]/article[1]/div[30]/pre[1]
  export MANPAGER="bat -plman"
  man 2 select
15t62e7yx3f p /html[1]/body[1]/article[1]/p[31]
  (on some older Debian or Ubuntu releases, the executable is named `batcat` instead of `bat`)
16ihwjknbbs p /html[1]/body[1]/article[1]/p[32]
  If you prefer to have this bundled in a new command, you can also use [link]`batman`[/link].
10xd3icqvmq p /html[1]/body[1]/article[1]/p[33]
  Note that the [link]Manpage syntax[/link] is developed in this repository and still needs some work.
099haf8n7z1 heading [h4] /html[1]/body[1]/article[1]/div[31]/h4[1]
  `prettier` / `shfmt` / `rustfmt`
0qn0kgtoptj p /html[1]/body[1]/article[1]/p[34]
  The [link]`prettybat`[/link] script is a wrapper that will format code and print it with `bat`.
0bavmj25zwa heading [h4] /html[1]/body[1]/article[1]/div[32]/h4[1]
  Highlighting `--help` messages
0tx0rcqmzu0 p /html[1]/body[1]/article[1]/p[35]
  You can use `bat` to colorize help text: `$ cp --help | bat -plhelp`
1otgcaqf5vf p /html[1]/body[1]/article[1]/p[36]
  You can also use a wrapper around this:
1slkmcjr38p code [no-translate] /html[1]/body[1]/article[1]/div[33]/pre[1]
  # in your .bashrc/.zshrc/*rc
  alias bathelp='bat --plain --language=help'
  help() {
      "$@" --help 2>&1 | bathelp
  }
0c4msle618p p /html[1]/body[1]/article[1]/p[37]
  Then you can do `$ help cp` or `$ help git commit`.
0nhtgm2ik8l p /html[1]/body[1]/article[1]/p[38]
  When you are using `zsh`, you can also use global aliases to override `-h` and `--help` entirely:
0g6ikh9sf60 code [no-translate] /html[1]/body[1]/article[1]/div[34]/pre[1]
  alias -g -- -h='-h 2>&1 | bat --language=help --style=plain'
  alias -g -- --help='--help 2>&1 | bat --language=help --style=plain'
274n2yvhuaz p /html[1]/body[1]/article[1]/p[39]
  For `fish`, you can use abbreviations:
0o1ot938gdk code [no-translate] /html[1]/body[1]/article[1]/div[35]/pre[1]
  abbr -a --position anywhere -- --help '--help | bat -plhelp'
  abbr -a --position anywhere -- -h '-h | bat -plhelp'
1sfrz5v0hcz p /html[1]/body[1]/article[1]/p[40]
  This way, you can keep on using `cp --help`, but get colorized help pages.
0p2iflatx95 p /html[1]/body[1]/article[1]/div[36]/p[1]
  Tip
18s3igi3shu p /html[1]/body[1]/article[1]/div[36]/p[2]
  To remove these abbreviations later, run:
05kycgkwcgb code [no-translate] /html[1]/body[1]/article[1]/div[36]/div[1]/pre[1]
  abbr -e -- --help
  abbr -e -- -h
22u3w03e07m p /html[1]/body[1]/article[1]/div[36]/p[3]
  The `--` before the abbreviation name is required because `--help` and `-h` start with dashes, which would otherwise be interpreted as flags to `abbr` itself.
034ig8ty6qy p /html[1]/body[1]/article[1]/p[41]
  Be aware that in some cases, `-h` may not be a shorthand of `--help` (for example with `ls`). In cases where you need to use `-h` as a command argument you can prepend `\` to the argument (eg. `ls \-h`) to escape the aliasing defined above.
1x6pyzrph4i p /html[1]/body[1]/article[1]/p[42]
  Please report any issues with the help syntax in [link]this repository[/link].
0c0yzfa37lu heading [h2] /html[1]/body[1]/article[1]/div[37]/h2[1]
  Installation
22ymv9jyil6 heading [h3] /html[1]/body[1]/article[1]/div[38]/h3[1]
  On Ubuntu (using `apt`)
25iex5w9wzj p /html[1]/body[1]/article[1]/p[44]
  *... and other Debian-based Linux distributions.*
0m7f2kdkz08 p /html[1]/body[1]/article[1]/p[45]
  `bat` is available on [link]Ubuntu since 20.04 ("Focal")[/link] and [link]Debian since August 2021 (Debian 11 - "Bullseye")[/link].
13y7i2crs4v p /html[1]/body[1]/article[1]/p[46]
  If your Ubuntu/Debian installation is new enough you can simply run:
21h1p1ctqq8 code [no-translate] /html[1]/body[1]/article[1]/div[39]/pre[1]
  sudo apt install bat
00ipdbgav3w p /html[1]/body[1]/article[1]/p[47]
  *Important*: On some older Ubuntu/Debian releases, the executable is installed as `batcat` instead of `bat` (due to [link]a name clash with another package[/link]). On newer releases, the executable is available as `bat`. If `bat --version` does not work after installation, try `batcat --version` instead. You can set up a `bat -> batcat` symlink or alias to prevent any issues that may come up because of this and to be consistent with other distributions:
0oyl5vyc9iw code [no-translate] /html[1]/body[1]/article[1]/div[40]/pre[1]
  mkdir -p ~/.local/bin
  ln -s /usr/bin/batcat ~/.local/bin/bat
2f570an7he6 p /html[1]/body[1]/article[1]/p[48]
  an example alias for `batcat` as `bat`:
1sm9l8x01kj code [no-translate] /html[1]/body[1]/article[1]/div[41]/pre[1]
  alias bat="batcat"
2a6fc51omx3 heading [h3] /html[1]/body[1]/article[1]/div[42]/h3[1]
  On Ubuntu (using most recent `.deb` packages)
0wevmn06a9c p /html[1]/body[1]/article[1]/p[49]
  *... and other Debian-based Linux distributions.*
18f9owkrn8q p /html[1]/body[1]/article[1]/p[50]
  If the package has not yet been promoted to your Ubuntu/Debian installation, or you want the most recent release of `bat`, download the latest `.deb` package from the [link]release page[/link] and install it via:
1r4xkz4s6pg code [no-translate] /html[1]/body[1]/article[1]/div[43]/pre[1]
  sudo dpkg -i bat_0.18.3_amd64.deb  # adapt version number and architecture
2252gslvezy heading [h3] /html[1]/body[1]/article[1]/div[44]/h3[1]
  On Alpine Linux
1edr6lp4wxf p /html[1]/body[1]/article[1]/p[51]
  You can install [link]the `bat` package[/link] from the official sources, provided you have the appropriate repository enabled:
0h7zv4stw5z code [no-translate] /html[1]/body[1]/article[1]/div[45]/pre[1]
  apk add bat
190dc8idlic heading [h3] /html[1]/body[1]/article[1]/div[46]/h3[1]
  On Arch Linux
0432kjgbmjz p /html[1]/body[1]/article[1]/p[52]
  You can install [link]the `bat` package[/link] from the official sources:
0rs6osrj0lk code [no-translate] /html[1]/body[1]/article[1]/div[47]/pre[1]
  pacman -S bat
0jwfp9uxch1 heading [h3] /html[1]/body[1]/article[1]/div[48]/h3[1]
  On Fedora
0gi3cma58sv p /html[1]/body[1]/article[1]/p[53]
  You can install [link]the `bat` package[/link] from the official sources:
05tbpe01nk9 code [no-translate] /html[1]/body[1]/article[1]/div[49]/pre[1]
  dnf install bat
1q442rsq19x heading [h3] /html[1]/body[1]/article[1]/div[50]/h3[1]
  On Gentoo Linux
2aulfet95s6 p /html[1]/body[1]/article[1]/p[54]
  You can install [link]the `bat` package[/link] from the official sources:
17i47kn5c0g code [no-translate] /html[1]/body[1]/article[1]/div[51]/pre[1]
  emerge sys-apps/bat
1j7ooa8f681 heading [h3] /html[1]/body[1]/article[1]/div[52]/h3[1]
  On FreeBSD
08vs8simpmr p /html[1]/body[1]/article[1]/p[55]
  You can install a precompiled [link]`bat` package[/link] with pkg:
0a0er4edv4c code [no-translate] /html[1]/body[1]/article[1]/div[53]/pre[1]
  pkg install bat
0hbyw21b6hf p /html[1]/body[1]/article[1]/p[56]
  or build it on your own from the FreeBSD ports:
1o5bbh9pvio code [no-translate] /html[1]/body[1]/article[1]/div[54]/pre[1]
  cd /usr/ports/textproc/bat
  make install
134rsj2pg7r heading [h3] /html[1]/body[1]/article[1]/div[55]/h3[1]
  On OpenBSD
29oboi5prut p /html[1]/body[1]/article[1]/p[57]
  You can install `bat` package using [link]`pkg_add(1)`[/link]:
192aa0zns4w code [no-translate] /html[1]/body[1]/article[1]/div[56]/pre[1]
  pkg_add bat
26ga2mhchwv heading [h3] /html[1]/body[1]/article[1]/div[57]/h3[1]
  Via nix
0m3qrunn5pt p /html[1]/body[1]/article[1]/p[58]
  You can install `bat` using the [link]nix package manager[/link]:
1aqfhwkwk57 code [no-translate] /html[1]/body[1]/article[1]/div[58]/pre[1]
  nix-env -i bat
0ytefhw1xkw heading [h3] /html[1]/body[1]/article[1]/div[59]/h3[1]
  On openSUSE
0vye3pumh6a p /html[1]/body[1]/article[1]/p[59]
  You can install `bat` with zypper:
1tw4600icv1 code [no-translate] /html[1]/body[1]/article[1]/div[60]/pre[1]
  zypper install bat
0rdp3sbmmp5 heading [h3] /html[1]/body[1]/article[1]/div[61]/h3[1]
  Via snap package
11dws4lji19 p /html[1]/body[1]/article[1]/p[60]
  There is currently no recommended snap package available. Existing packages may be available, but are not officially supported and may contain [link]issues[/link].
2321yeml0w6 heading [h3] /html[1]/body[1]/article[1]/div[62]/h3[1]
  On macOS (or Linux) via Homebrew
1a82eyoku4p p /html[1]/body[1]/article[1]/p[61]
  You can install `bat` with [link]Homebrew[/link]:
09efoecx9ne code [no-translate] /html[1]/body[1]/article[1]/div[63]/pre[1]
  brew install bat
1q6emg89y2j heading [h3] /html[1]/body[1]/article[1]/div[64]/h3[1]
  On macOS via MacPorts
182egs45nl0 p /html[1]/body[1]/article[1]/p[62]
  Or install `bat` with [link]MacPorts[/link]:
06de32lalms code [no-translate] /html[1]/body[1]/article[1]/div[65]/pre[1]
  port install bat
19b2677sj0z heading [h3] /html[1]/body[1]/article[1]/div[66]/h3[1]
  On Windows
06srwmqtfsv p /html[1]/body[1]/article[1]/p[63]
  There are a few options to install `bat` on Windows. Once you have installed `bat`, take a look at the [link]"Using `bat` on Windows"[/link] section.
19rl4qfuiww heading [h4] /html[1]/body[1]/article[1]/div[67]/h4[1]
  Prerequisites
2201v1wwwu0 p /html[1]/body[1]/article[1]/p[64]
  You will need to install the [link]Visual C++ Redistributable[/link]
12n8ljvqwzg heading [h4] /html[1]/body[1]/article[1]/div[68]/h4[1]
  With WinGet
2arq94c14ew p /html[1]/body[1]/article[1]/p[65]
  You can install `bat` via [link]WinGet[/link]:
1fxy1wdg7ws code [no-translate] /html[1]/body[1]/article[1]/div[69]/pre[1]
  winget install sharkdp.bat
1dr65q1kbkr heading [h4] /html[1]/body[1]/article[1]/div[70]/h4[1]
  With Chocolatey
2b7ymtpqay7 p /html[1]/body[1]/article[1]/p[66]
  You can install `bat` via [link]Chocolatey[/link]:
069dmuamnbh code [no-translate] /html[1]/body[1]/article[1]/div[71]/pre[1]
  choco install bat
217tfyz0pus heading [h4] /html[1]/body[1]/article[1]/div[72]/h4[1]
  With Scoop
01anpgggwcx p /html[1]/body[1]/article[1]/p[67]
  You can install `bat` via [link]scoop[/link]:
0a7ibmntnmb code [no-translate] /html[1]/body[1]/article[1]/div[73]/pre[1]
  scoop install bat
1m8vc0v9896 heading [h4] /html[1]/body[1]/article[1]/div[74]/h4[1]
  From prebuilt binaries:
0lc2jdmc2wx p /html[1]/body[1]/article[1]/p[68]
  You can download prebuilt binaries from the [link]Release page[/link],
094kq8tped2 p /html[1]/body[1]/article[1]/p[69]
  You will need to install the [link]Visual C++ Redistributable[/link] package.
00go3nrfzbf heading [h3] /html[1]/body[1]/article[1]/div[75]/h3[1]
  From binaries
1et311nttly p /html[1]/body[1]/article[1]/p[70]
  Check out the [link]Release page[/link] for prebuilt versions of `bat` for many different architectures. Statically-linked binaries are also available: look for archives with `musl` in the file name.
054rgps8lun heading [h3] /html[1]/body[1]/article[1]/div[76]/h3[1]
  From source
2018if9k6jm p /html[1]/body[1]/article[1]/p[71]
  If you want to build `bat` from source, you need Rust 1.79.0 or higher. You can then use `cargo` to build everything:
0fxillrphbm heading [h4] /html[1]/body[1]/article[1]/div[77]/h4[1]
  From local source
0towd8d0ub8 code [no-translate] /html[1]/body[1]/article[1]/div[78]/pre[1]
  cargo install --path . --locked
094jeevmb9b p /html[1]/body[1]/article[1]/div[79]/p[1]
  Note
23pf21lyt7n p /html[1]/body[1]/article[1]/div[79]/p[2]
  The `--path .` above specifies the directory of the source code and NOT where `bat` will be installed. For more information see the docs for [link]`cargo install`[/link].
0ev0502wmb6 heading [h4] /html[1]/body[1]/article[1]/div[80]/h4[1]
  From `crates.io`
0cwj7zghmd7 code [no-translate] /html[1]/body[1]/article[1]/div[81]/pre[1]
  cargo install --locked bat
10w24wuuqxb p /html[1]/body[1]/article[1]/p[72]
  Note that additional files like the man page or shell completion files can not be installed automatically in both these ways. If installing from a local source, they will be generated by `cargo` and should be available in the cargo target folder under `build`.
1qnqykf3lnf p /html[1]/body[1]/article[1]/p[73]
  Furthermore, shell completions are also available by running:
0pawwrohn8a code [no-translate] /html[1]/body[1]/article[1]/div[82]/pre[1]
  bat --completion <shell>
  # see --help for supported shells
0d8093ygvdr heading [h2] /html[1]/body[1]/article[1]/div[83]/h2[1]
  Customization
2ehz790y14q heading [h3] /html[1]/body[1]/article[1]/div[84]/h3[1]
  Highlighting theme
1oyr8w845kq p /html[1]/body[1]/article[1]/p[74]
  Use `bat --list-themes` to get a list of all available themes for syntax highlighting. By default, `bat` uses `Monokai Extended` or `Monokai Extended Light` for dark and light themes respectively. To select the `TwoDark` theme, call `bat` with the `--theme=TwoDark` option or set the `BAT_THEME` environment variable to `TwoDark`. Use `export BAT_THEME="TwoDark"` in your shell's startup file to make the change permanent. Alternatively, use `bat`'s [link]configuration file[/link].
06az9t3uyyn p /html[1]/body[1]/article[1]/p[75]
  If you want to preview the different themes on a custom file, you can use the following command (you need [link]`fzf`[/link] for this):
2dqkbun4z05 code [no-translate] /html[1]/body[1]/article[1]/div[85]/pre[1]
  bat --list-themes | fzf --preview="bat --theme={} --color=always /path/to/file"
21uthjx0x6k p /html[1]/body[1]/article[1]/p[76]
  `bat` automatically picks a fitting theme depending on your terminal's background color. You can use the `--theme-dark` / `--theme-light` options or the `BAT_THEME_DARK` / `BAT_THEME_LIGHT` environment variables to customize the themes used. This is especially useful if you frequently switch between dark and light mode.
1rqf84v0np3 p /html[1]/body[1]/article[1]/p[77]
  You can also use a custom theme by following the [link]'Adding new themes' section below[/link].
2bf1gpkfvl2 heading [h3] /html[1]/body[1]/article[1]/div[86]/h3[1]
  8-bit themes
0k14ksvpskt p /html[1]/body[1]/article[1]/p[78]
  `bat` has three themes that always use [link]8-bit colors[/link], even when truecolor support is available:
1i7jstwsm4d li /html[1]/body[1]/article[1]/ul[1]/li[1]
  `ansi` looks decent on any terminal. It uses 3-bit colors: black, red, green, yellow, blue, magenta, cyan, and white.
0e9elmdbgog li /html[1]/body[1]/article[1]/ul[1]/li[2]
  `base16` is designed for [link]base16[/link] terminal themes. It uses 4-bit colors (3-bit colors plus bright variants) in accordance with the [link]base16 styling guidelines[/link].
03re0humwei li /html[1]/body[1]/article[1]/ul[1]/li[3]
  `base16-256` is designed for [link]tinted-shell[/link]. It replaces certain bright colors with 8-bit colors from 16 to 21. *Do not* use this simply because you have a 256-color terminal but are not using tinted-shell.
1mbhf6v3c8k p /html[1]/body[1]/article[1]/p[79]
  Although these themes are more restricted, they have three advantages over truecolor themes. They:
1dpaw8vihji li /html[1]/body[1]/article[1]/ul[2]/li[1]
  Enjoy maximum compatibility. Some terminal utilities do not support more than 3-bit colors.
1nnusx8lz90 li /html[1]/body[1]/article[1]/ul[2]/li[2]
  Adapt to terminal theme changes. Even for already printed output.
1t6ocx77smh li /html[1]/body[1]/article[1]/ul[2]/li[3]
  Visually harmonize better with other terminal software.
0ansevjywxg heading [h3] /html[1]/body[1]/article[1]/div[87]/h3[1]
  Output style
05kbzfu29so p /html[1]/body[1]/article[1]/p[80]
  You can use the `--style` option to control the appearance of `bat`'s output. You can use `--style=numbers,changes`, for example, to show only Git changes and line numbers but no grid and no file header. Set the `BAT_STYLE` environment variable to make these changes permanent or use `bat`'s [link]configuration file[/link].
2avuoj0smse p /html[1]/body[1]/article[1]/p[81]
  By default, `bat` enables `changes`, `grid`, `header-filename`, `numbers`, and `snip`.
0aobycpo3x2 p /html[1]/body[1]/article[1]/p[82]
  The available pre-defined styles are:
0jmw5vpmf7i table-cell [group=row-144lj3kl4u1] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/thead[1]/tr[1]/th[1]
  Style
1gc4ozpuqml table-cell [group=row-144lj3kl4u1] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/thead[1]/tr[1]/th[2]
  Description
1h4sdkd6c0p table-cell [group=row-0k7axsxl85n] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[1]/td[1]
  `default`
0dvcx7wfywc table-cell [group=row-0k7axsxl85n] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[1]/td[2]
  Enables the recommended style components listed above.
1mh9xitz3jd table-cell [group=row-29b40ucz240] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[2]/td[1]
  `full`
0ssrcuddogl table-cell [group=row-29b40ucz240] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[2]/td[2]
  Enables all available components.
00bou5617fk table-cell [group=row-0vfoc5tzt3m] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[3]/td[1]
  `auto`
04zejfh0yv2 table-cell [group=row-0vfoc5tzt3m] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[3]/td[2]
  Same as `default`, unless the output is piped.
1axsgk1nqgc table-cell [group=row-2d7f0d3uf1l] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[4]/td[1]
  `plain`
20svy34xyk3 table-cell [group=row-2d7f0d3uf1l] /html[1]/body[1]/article[1]/markdown-accessiblity-table[1]/table[1]/tbody[1]/tr[4]/td[2]
  Disables all available components.
2dyj7vv9u48 p /html[1]/body[1]/article[1]/p[83]
  The available individual components are:
2ckus70qwsy table-cell [group=row-0majgzc0n3c] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/thead[1]/tr[1]/th[1]
  Component
1gqbur0pt6q table-cell [group=row-0majgzc0n3c] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/thead[1]/tr[1]/th[2]
  Description
21v8we7huya table-cell [group=row-0qyk61mra1z] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[1]/td[1]
  `changes`
03f8wmhwxt2 table-cell [group=row-0qyk61mra1z] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[1]/td[2]
  Show Git modification markers.
0azc4pa5sdj table-cell [group=row-0fmunnwy3jo] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[2]/td[1]
  `header`
1strr3oacp0 table-cell [group=row-0fmunnwy3jo] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[2]/td[2]
  Alias for `header-filename`.
2aqnmlbadyw table-cell [group=row-0sxzfd2oi86] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[3]/td[1]
  `header-filename`
06k9fh2losw table-cell [group=row-0sxzfd2oi86] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[3]/td[2]
  Show filenames before the content.
1l4g4tn3p30 table-cell [group=row-22eppzjpuqc] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[4]/td[1]
  `header-filesize`
1myk4wyl73w table-cell [group=row-22eppzjpuqc] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[4]/td[2]
  Show file sizes before the content.
11y5l7c6pgo table-cell [group=row-16221afedad] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[5]/td[1]
  `grid`
0siuapzk8sk table-cell [group=row-16221afedad] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[5]/td[2]
  Vertical/horizontal lines to separate the side bar and header from the content.
1l9rac2y7uv table-cell [group=row-0ec6kcfz7q0] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[6]/td[1]
  `rule`
18dcj120qrw table-cell [group=row-0ec6kcfz7q0] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[6]/td[2]
  Horizontal lines to delimit files.
1pl2ba16jfc table-cell [group=row-2b6bzlldsx2] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[7]/td[1]
  `numbers`
1eqa7uursan table-cell [group=row-2b6bzlldsx2] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[7]/td[2]
  Show line numbers in the side bar.
0qdiuc8bn9z table-cell [group=row-1z9eo0va423] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[8]/td[1]
  `snip`
21bzg24lhxg table-cell [group=row-1z9eo0va423] /html[1]/body[1]/article[1]/markdown-accessiblity-table[2]/table[1]/tbody[1]/tr[8]/td[2]
  Draw separation lines between distinct line ranges.
2bmqrqd8k6e p /html[1]/body[1]/article[1]/div[88]/p[1]
  Tip
1065mynlcz9 p /html[1]/body[1]/article[1]/div[88]/p[2]
  If you specify a default style in `bat`'s config file, you can change which components are displayed during a single run of `bat` using the `--style` command-line argument. By prefixing a component with `+` or `-`, it can be added or removed from the current style.
1a7vc5k5f7d p /html[1]/body[1]/article[1]/div[88]/p[3]
  For example, if your config contains `--style=full,-snip`, you can run bat with `--style=-grid,+snip` to remove the grid and add back the `snip` component. Or, if you want to override the styles completely, you use `--style=numbers` to only show the line numbers.
13r8dvnj8zf heading [h3] /html[1]/body[1]/article[1]/div[89]/h3[1]
  Decorations
1530hoov252 p /html[1]/body[1]/article[1]/p[84]
  By default, `bat` only shows decorations (such as line numbers, file headers, grid borders, etc.) when outputting to an interactive terminal. You can control this behavior with the `--decorations` option. Use `--decorations=always` to show decorations even when piping output to another command, or `--decorations=never` to disable them entirely. Possible values are `auto` (default), `never`, and `always`.
0a73v28gjtu p /html[1]/body[1]/article[1]/p[85]
  There is also the `--force-colorization` option, which is an alias for `--decorations=always --color=always`. This is useful if you want to keep colorization and decorations when piping `bat`'s output to another program.
0l4o3j0gsq1 heading [h3] /html[1]/body[1]/article[1]/div[90]/h3[1]
  Adding new syntaxes / language definitions
0cb8y7x2gxl p /html[1]/body[1]/article[1]/p[86]
  Should you find that a particular syntax is not available within `bat`, you can follow these instructions to easily add new syntaxes to your current `bat` installation.
01j2g9j7ptn p /html[1]/body[1]/article[1]/p[87]
  `bat` uses the excellent [link]`syntect`[/link] library for syntax highlighting. `syntect` can read any [link]Sublime Text `.sublime-syntax` file[/link] and theme.
2cc11bymezg p /html[1]/body[1]/article[1]/p[88]
  A good resource for finding Sublime Syntax packages is [link]Package Control[/link]. Once you found a syntax:
1t72976cmhz li /html[1]/body[1]/article[1]/ol[1]/li[1]/p[1]
  Create a folder with syntax definition files:
1b9wpddeayv code [no-translate] /html[1]/body[1]/article[1]/ol[1]/li[1]/div[1]/pre[1]
  mkdir -p "$(bat --config-dir)/syntaxes"
  cd "$(bat --config-dir)/syntaxes"
  
  # Put new '.sublime-syntax' language definition files
  # in this folder (or its subdirectories), for example:
  git clone https://github.com/tellnobody1/sublime-purescript-syntax
0914uo28kb4 li /html[1]/body[1]/article[1]/ol[1]/li[2]/p[1]
  Now use the following command to parse these files into a binary cache:
1uiid4r23tb code [no-translate] /html[1]/body[1]/article[1]/ol[1]/li[2]/div[1]/pre[1]
  bat cache --build
0oth7xctrak li /html[1]/body[1]/article[1]/ol[1]/li[3]/p[1]
  Finally, use `bat --list-languages` to check if the new languages are available.
2213beu9fy5 li /html[1]/body[1]/article[1]/ol[1]/li[3]/p[2]
  If you ever want to go back to the default settings, call:
02a8f6idt28 code [no-translate] /html[1]/body[1]/article[1]/ol[1]/li[3]/div[1]/pre[1]
  bat cache --clear
0n3dxvf4pqb li /html[1]/body[1]/article[1]/ol[1]/li[4]/p[1]
  If you think that a specific syntax should be included in `bat` by default, please consider opening a "syntax request" ticket after reading the policies and instructions [link]here[/link]: [link]Open Syntax Request[/link].
0d95axi0lv5 heading [h3] /html[1]/body[1]/article[1]/div[91]/h3[1]
  Adding new themes
275s7puy38m p /html[1]/body[1]/article[1]/p[89]
  This works very similar to how we add new syntax definitions.
0vn37qbquyj p /html[1]/body[1]/article[1]/div[92]/p[1]
  Note
16hsrio868p p /html[1]/body[1]/article[1]/div[92]/p[2]
  Custom themes must be stored in [link]`.tmTheme` files[/link]. Newer `.sublime-color-scheme` files are currently not supported.
0dnsahn7vnf p /html[1]/body[1]/article[1]/p[90]
  First, create a folder with the new syntax highlighting themes:
23w9c2i7otc code [no-translate] /html[1]/body[1]/article[1]/div[93]/pre[1]
  mkdir -p "$(bat --config-dir)/themes"
  cd "$(bat --config-dir)/themes"
  
  # Download a theme in '.tmTheme' format, for example:
  git clone https://github.com/greggb/sublime-snazzy
  
  # Update the binary cache
  bat cache --build
0ekgw5ixxox p /html[1]/body[1]/article[1]/p[91]
  Finally, use `bat --list-themes` to check if the new themes are available.
0ce03ld5qo4 p /html[1]/body[1]/article[1]/div[94]/p[1]
  Note
29bneon5ch1 p /html[1]/body[1]/article[1]/div[94]/p[2]
  `bat` uses the name of the `.tmTheme` file for the theme's name.
1nrn4zm82dx heading [h3] /html[1]/body[1]/article[1]/div[95]/h3[1]
  Adding or changing file type associations
0z0f9dplf9o p /html[1]/body[1]/article[1]/p[92]
  You can add new (or change existing) file name patterns using the `--map-syntax` command line option. The option takes an argument of the form `pattern:syntax` where `pattern` is a glob pattern that is matched against the file name and the absolute file path. The `syntax` part is the full name of a supported language (use `bat --list-languages` for an overview).
1toyi7aq7q4 p /html[1]/body[1]/article[1]/p[93]
  *Note:* You probably want to use this option as [link]an entry in `bat`'s configuration file[/link] for persistence instead of passing it on the command line as a one-off. Generally you'd just use `-l` if you want to manually specify a language for a file.
1smw3qxxc8v p /html[1]/body[1]/article[1]/p[94]
  Example: To use "INI" syntax highlighting for all files with a `.conf` file extension, use
232078r3jr4 code [no-translate] /html[1]/body[1]/article[1]/div[96]/pre[1]
  --map-syntax='*.conf:INI'
2bcga58ii2k p /html[1]/body[1]/article[1]/p[95]
  Example: To open all files called `.ignore` (exact match) with the "Git Ignore" syntax, use:
1xvt024svgo code [no-translate] /html[1]/body[1]/article[1]/div[97]/pre[1]
  --map-syntax='.ignore:Git Ignore'
10vkcqj9a52 p /html[1]/body[1]/article[1]/p[96]
  Example: To open all `.conf` files in subfolders of `/etc/apache2` with the "Apache Conf" syntax, use (this mapping is already built in):
27z9qu2tcjx code [no-translate] /html[1]/body[1]/article[1]/div[98]/pre[1]
  --map-syntax='/etc/apache2/**/*.conf:Apache Conf'
1ue2el78ijv heading [h3] /html[1]/body[1]/article[1]/div[99]/h3[1]
  Using a different pager
150ot3kxzv7 p /html[1]/body[1]/article[1]/p[97]
  `bat` uses the pager that is specified in the `PAGER` environment variable. If this variable is not set, `less` is used by default. You can also use bat's built-in pager with `--pager=builtin` or by setting the `BAT_PAGER` environment variable to "builtin".
20ldud90yck p /html[1]/body[1]/article[1]/p[98]
  If you want to use a different pager, you can either modify the `PAGER` variable or set the `BAT_PAGER` environment variable to override what is specified in `PAGER`.
2dttuggs64l p /html[1]/body[1]/article[1]/div[100]/p[1]
  Note
1kvwrl5q5h8 p /html[1]/body[1]/article[1]/div[100]/p[2]
  If `PAGER` is `more` or `most`, `bat` will silently use `less` instead to ensure support for colors.
0qqz6i9i0es p /html[1]/body[1]/article[1]/p[99]
  If you want to pass command-line arguments to the pager, you can also set them via the `PAGER`/`BAT_PAGER` variables:
18zlzw492we code [no-translate] /html[1]/body[1]/article[1]/div[101]/pre[1]
  export BAT_PAGER="less -RFK"
1mkmlcksnqn p /html[1]/body[1]/article[1]/p[100]
  Instead of using environment variables, you can also use `bat`'s [link]configuration file[/link] to configure the pager (`--pager` option).
0tpwms3lwe3 heading [h3] /html[1]/body[1]/article[1]/div[102]/h3[1]
  Using `less` as a pager
20w1iobkd8m p /html[1]/body[1]/article[1]/p[101]
  When using `less` as a pager, `bat` will automatically pass extra options along to `less` to improve the experience. Specifically, `-R`/`--RAW-CONTROL-CHARS`, `-F`/`--quit-if-one-screen`, `-K`/`--quit-on-intr` and under certain conditions, `-X`/`--no-init` and/or `-S`/`--chop-long-lines`.
13yr4ec4dq5 p /html[1]/body[1]/article[1]/div[103]/p[1]
  Important
0fvsjpvr6vd p /html[1]/body[1]/article[1]/div[103]/p[2]
  These options will not be added if:
2dt99l5kje2 li /html[1]/body[1]/article[1]/div[103]/ul[1]/li[1]
  The pager is not named `less`.
1mkgz0cc3a2 li /html[1]/body[1]/article[1]/div[103]/ul[1]/li[2]
  The `--pager` argument contains any command-line arguments (e.g. `--pager="less -R"`).
09hl9qd08ru li /html[1]/body[1]/article[1]/div[103]/ul[1]/li[3]
  The `BAT_PAGER` environment variable contains any command-line arguments (e.g. `export BAT_PAGER="less -R"`)
26qc5v5vrdz p /html[1]/body[1]/article[1]/div[103]/p[3]
  The `--quit-if-one-screen` option will not be added when:
20zcpkijnkj li /html[1]/body[1]/article[1]/div[103]/ul[2]/li[1]
  The `--paging=always` argument is used.
0sbpzpdwiuc li /html[1]/body[1]/article[1]/div[103]/ul[2]/li[2]
  The `BAT_PAGING` environment is set to `always`.
011gwx2khiv p /html[1]/body[1]/article[1]/p[102]
  The `-R`/`--RAW-CONTROL-CHARS` option is needed to interpret ANSI colors correctly.
1311pn8rlgv p /html[1]/body[1]/article[1]/p[103]
  The `-F`/`--quit-if-one-screen` option instructs `less` to exit immediately if the output size is smaller than the vertical size of the terminal. This is convenient for small files because you do not have to press `q` to quit the pager.
1lxxkk9hc4l p /html[1]/body[1]/article[1]/p[104]
  The `-K`/`--quit-on-intr` option instructs `less` to exit immediately when an interrupt signal is received. This is useful to ensure that `less` quits together with `bat` on SIGINT.
2bja4n6em4h p /html[1]/body[1]/article[1]/p[105]
  The `-X`/`--no-init` option is added to versions of `less` older than version 530 (older than 558 on Windows) to fix a bug with the `-F`/`--quit-if-one-screen` feature. Unfortunately, it also breaks mouse-wheel support in `less`. If you want to enable mouse-wheel scrolling on older versions of `less` and do not mind losing the quit-if-one-screen feature, you can set the pager (via `--pager` or `BAT_PAGER`) to `less -R`. For `less` 530 or newer, it should work out of the box.
24k4cgbdl7p p /html[1]/body[1]/article[1]/p[106]
  The `-S`/`--chop-long-lines` option is added when `bat`'s `-S`/`--chop-long-lines` option is used. This tells `less` to truncate any lines larger than the terminal width.
1v4yxted4fs heading [h3] /html[1]/body[1]/article[1]/div[104]/h3[1]
  Indentation
0r59txs35j8 p /html[1]/body[1]/article[1]/p[107]
  `bat` expands tabs to 4 spaces by itself, not relying on the pager. To change this, simply add the `--tabs` argument with the number of spaces you want to be displayed.
0kqt8zgfvf1 p /html[1]/body[1]/article[1]/p[108]
  *Note*: Defining tab stops for the pager (via the `--pager` argument by `bat`, or via the `LESS` environment variable for `less`) won't be taken into account because the pager will already get expanded spaces instead of tabs. This behaviour is added to avoid indentation issues caused by the sidebar. Calling `bat` with `--tabs=0` will override it and let tabs be consumed by the pager.
1r2mj5jmzcx heading [h3] /html[1]/body[1]/article[1]/div[105]/h3[1]
  Dark mode
11zwms5q6a6 p /html[1]/body[1]/article[1]/p[109]
  If you make use of the dark mode feature in *macOS*, you might want to configure `bat` to use a different theme based on the OS theme. The following snippet uses the `default` theme when in the *dark mode* and the `GitHub` theme when in the *light mode*.
1gi2f4mq7vq code [no-translate] /html[1]/body[1]/article[1]/div[106]/pre[1]
  alias cat="bat --theme auto:system --theme-dark default --theme-light GitHub"
1wo2vuu45qo p /html[1]/body[1]/article[1]/p[110]
  The same dark mode feature is now available in *GNOME* and affects the `org.gnome.desktop.interface color-scheme` setting. The following code converts the above to use said setting.
0028pu5e2ik code [no-translate] /html[1]/body[1]/article[1]/div[107]/pre[1]
  # .bashrc
  sys_color_scheme_is_dark() {
      condition=$(gsettings get org.gnome.desktop.interface color-scheme)
      condition=$(echo "$condition" | tr -d "[:space:]'")
      if [ $condition == "prefer-dark" ]; then
          return 0
      else
          return 1
      fi
  }
  
  bat_alias_wrapper() {
      #get color scheme
      sys_color_scheme_is_dark
      if [[ $? -eq 0 ]]; then
          # bat command with dark color scheme
          bat --theme=default "$@"
      else
          # bat command with light color scheme
          bat --theme=GitHub "$@"
      fi
  }
  alias cat='bat_alias_wrapper'
08t74wgzucn heading [h2] /html[1]/body[1]/article[1]/div[108]/h2[1]
  Configuration file
27yjl7sl0c5 p /html[1]/body[1]/article[1]/p[111]
  `bat` can also be customized with a configuration file. The location of the file is dependent on your operating system. To get the default path for your system, call
225dcdv1837 code [no-translate] /html[1]/body[1]/article[1]/div[109]/pre[1]
  bat --config-file
23mw1endide p /html[1]/body[1]/article[1]/p[112]
  Alternatively, you can use `BAT_CONFIG_PATH` or `BAT_CONFIG_DIR` environment variables to point `bat` to a non-default location of the configuration file or the configuration directory respectively:
15ulismm0oh code [no-translate] /html[1]/body[1]/article[1]/div[110]/pre[1]
  export BAT_CONFIG_PATH="/path/to/bat/bat.conf"
  export BAT_CONFIG_DIR="/path/to/bat"
271lsl08gru p /html[1]/body[1]/article[1]/p[113]
  A default configuration file can be created with the `--generate-config-file` option.
0xe7zc267g6 code [no-translate] /html[1]/body[1]/article[1]/div[111]/pre[1]
  bat --generate-config-file
1orw19xhw12 p /html[1]/body[1]/article[1]/p[114]
  There is also now a systemwide configuration file, which is located under `/etc/bat/config` on Linux and Mac OS and `C:\ProgramData\bat\config` on windows. If the system wide configuration file is present, the content of the user configuration will simply be appended to it.
1lheqi1zmmz heading [h3] /html[1]/body[1]/article[1]/div[112]/h3[1]
  Format
0iwtadwe2m4 p /html[1]/body[1]/article[1]/p[115]
  The configuration file is a simple list of command line arguments. Use `bat --help` to see a full list of possible options and values. In addition, you can add comments by prepending a line with the `#` character.
1amldru3rky p /html[1]/body[1]/article[1]/p[116]
  Example configuration file:
01m89p080pb code [no-translate] /html[1]/body[1]/article[1]/div[113]/pre[1]
  # Set the theme to "TwoDark"
  --theme="TwoDark"
  
  # Show line numbers, Git modifications and file header (but no grid)
  --style="numbers,changes,header"
  
  # Use italic text on the terminal (not supported on all terminals)
  --italic-text=always
  
  # Use C++ syntax for Arduino .ino files
  --map-syntax "*.ino:C++"
0ygm48nhmek heading [h2] /html[1]/body[1]/article[1]/div[114]/h2[1]
  Using `bat` on Windows
02a6m5r8h0j p /html[1]/body[1]/article[1]/p[117]
  `bat` mostly works out-of-the-box on Windows, but a few features may need extra configuration.
2ek9ullerlz heading [h3] /html[1]/body[1]/article[1]/div[115]/h3[1]
  Prerequisites
15lud57gp50 p /html[1]/body[1]/article[1]/p[118]
  You will need to install the [link]Visual C++ Redistributable[/link] package.
0k3p4cmjpy4 heading [h3] /html[1]/body[1]/article[1]/div[116]/h3[1]
  Paging
1ao9vb3e3im p /html[1]/body[1]/article[1]/p[119]
  Windows only includes a very limited pager in the form of `more`. You can download a Windows binary for `less` [link]from its homepage[/link] or [link]through Chocolatey[/link]. To use it, place the binary in a directory in your `PATH` or [link]define an environment variable[/link]. The [link]Chocolatey package[/link] installs `less` automatically.
0aecr1tk97t heading [h3] /html[1]/body[1]/article[1]/div[117]/h3[1]
  Colors
08ph6fxbhy5 p /html[1]/body[1]/article[1]/p[120]
  Windows 10 natively supports colors in both `conhost.exe` (Command Prompt) and PowerShell since [link]v1511[/link], as well as in newer versions of bash. On earlier versions of Windows, you can use [link]Cmder[/link], which includes [link]ConEmu[/link].
2aj8k8vvei1 p /html[1]/body[1]/article[1]/p[121]
  *Note:* Old versions of `less` do not correctly interpret colors on Windows. To fix this, you can add the optional Unix tools to your PATH when installing Git. If you don’t have any other pagers installed, you can disable paging entirely by passing `--paging=never` or by setting `BAT_PAGER` to an empty string.
0nuk787q4j0 heading [h3] /html[1]/body[1]/article[1]/div[118]/h3[1]
  Cygwin
25vxaxdcswr p /html[1]/body[1]/article[1]/p[122]
  `bat` on Windows does not natively support Cygwin's unix-style paths (`/cygdrive/*`). When passed an absolute cygwin path as an argument, `bat` will encounter the following error: `The system cannot find the path specified. (os error 3)`
195hg565aqp p /html[1]/body[1]/article[1]/p[123]
  This can be solved by creating a wrapper or adding the following function to your `.bash_profile` file:
00bi7fzwjqe code [no-translate] /html[1]/body[1]/article[1]/div[119]/pre[1]
  bat() {
      local index
      local args=("$@")
      for index in $(seq 0 ${#args[@]}) ; do
          case "${args[index]}" in
          -*) continue;;
          *)  [ -e "${args[index]}" ] && args[index]="$(cygpath --windows "${args[index]}")";;
          esac
      done
      command bat "${args[@]}"
  }
24bm99jt91o heading [h2] /html[1]/body[1]/article[1]/div[120]/h2[1]
  Troubleshooting
18f6vtiducs heading [h3] /html[1]/body[1]/article[1]/div[121]/h3[1]
  Garbled output
21hkekc0uwm p /html[1]/body[1]/article[1]/p[124]
  If an input file contains color codes or other ANSI escape sequences or control characters, `bat` will have problems performing syntax highlighting and text wrapping, and thus the output can become garbled.
01aaq5q3sgf p /html[1]/body[1]/article[1]/p[125]
  If your version of `bat` supports the `--strip-ansi=auto` option, it can be used to remove such sequences before syntax highlighting. Alternatively, you may disable both syntax highlighting and wrapping by passing the `--color=never --wrap=never` options to `bat`.
1grvxd5g00y p /html[1]/body[1]/article[1]/p[126]
  For untrusted input, the `--sanitize=auto|always|never` option additionally replaces terminal-active control bytes and Unicode bidi / zero-width formatting characters with the Unicode replacement character. It implies `--strip-ansi` at the same value.
0rvklwgx8dt p /html[1]/body[1]/article[1]/div[122]/p[1]
  Note
0vnvvomtv8t p /html[1]/body[1]/article[1]/div[122]/p[2]
  The `auto` option of `--strip-ansi` avoids removing escape sequences when the syntax is plain text.
1vk5c3hodup heading [h3] /html[1]/body[1]/article[1]/div[123]/h3[1]
  Terminals & colors
1j5ynqb22be p /html[1]/body[1]/article[1]/p[127]
  `bat` handles terminals *with* and *without* truecolor support. However, the colors in most syntax highlighting themes are not optimized for 8-bit colors. It is therefore strongly recommended that you use a terminal with 24-bit truecolor support (`terminator`, `konsole`, `iTerm2`, ...), or use one of the basic [link]8-bit themes[/link] designed for a restricted set of colors. See [link]this article[/link] for more details and a full list of terminals with truecolor support.
06oua1lnmku p /html[1]/body[1]/article[1]/p[128]
  Make sure that your truecolor terminal sets the `COLORTERM` variable to either `truecolor` or `24bit`. Otherwise, `bat` will not be able to determine whether or not 24-bit escape sequences are supported (and fall back to 8-bit colors).
02ytibxii49 heading [h3] /html[1]/body[1]/article[1]/div[124]/h3[1]
  Line numbers and grid are hardly visible
1mlavcydihq p /html[1]/body[1]/article[1]/p[129]
  Please try a different theme (see `bat --list-themes` for a list). The `OneHalfDark` and `OneHalfLight` themes provide grid and line colors that are brighter.
0fm1q32yjhv heading [h3] /html[1]/body[1]/article[1]/div[125]/h3[1]
  File encodings
0e0zzus1y55 p /html[1]/body[1]/article[1]/p[130]
  `bat` natively supports UTF-8 as well as UTF-16. For every other file encoding, you may need to convert to UTF-8 first because the encodings can typically not be auto-detected. You can `iconv` to do so. Example: if you have a PHP file in Latin-1 (ISO-8859-1) encoding, you can call:
0hw47ju0hzh code [no-translate] /html[1]/body[1]/article[1]/div[126]/pre[1]
  iconv -f ISO-8859-1 -t UTF-8 my-file.php | bat
2elqnt11bir p /html[1]/body[1]/article[1]/p[131]
  Note: you might have to use the `-l`/`--language` option if the syntax can not be auto-detected by `bat`.
0ecutq41jtz heading [h2] /html[1]/body[1]/article[1]/div[127]/h2[1]
  Development
290lio2vzyo code [no-translate] /html[1]/body[1]/article[1]/div[128]/pre[1]
  # Recursive clone to retrieve all submodules
  git clone --recursive https://github.com/sharkdp/bat
  
  # Build (debug version)
  cd bat
  cargo build --bins
  
  # Run unit tests and integration tests
  cargo test
  
  # Install (release version)
  cargo install --path . --locked
  
  # Build a bat binary with modified syntaxes and themes
  bash assets/create.sh
  cargo install --path . --locked --force
1wal3t6ujxh p /html[1]/body[1]/article[1]/p[132]
  If you want to build an application that uses `bat`'s pretty-printing features as a library, check out the [link]API documentation[/link]. Note that you have to use either `regex-onig` or `regex-fancy` as a feature when you depend on `bat` as a library.
1rl2la80pus heading [h2] /html[1]/body[1]/article[1]/div[129]/h2[1]
  Contributing
0nxu290soc5 p /html[1]/body[1]/article[1]/p[133]
  Take a look at the [link]`CONTRIBUTING.md`[/link] guide.
1krxn66ig9e heading [h2] /html[1]/body[1]/article[1]/div[130]/h2[1]
  Maintainers
2dkrojlp5ou li /html[1]/body[1]/article[1]/ul[3]/li[1]
  [link]sharkdp[/link]
1kypqrh59e2 li /html[1]/body[1]/article[1]/ul[3]/li[2]
  [link]eth-p[/link]
1re2jcwhujh li /html[1]/body[1]/article[1]/ul[3]/li[3]
  [link]keith-hall[/link]
0wdbyf7fla0 li /html[1]/body[1]/article[1]/ul[3]/li[4]
  [link]Enselic[/link]
10s6lr375hv heading [h2] /html[1]/body[1]/article[1]/div[131]/h2[1]
  Security vulnerabilities
0y0viegg7a0 p /html[1]/body[1]/article[1]/p[134]
  See [link]`SECURITY.md`[/link].
101pt395z79 heading [h2] /html[1]/body[1]/article[1]/div[132]/h2[1]
  Project goals and alternatives
2d4emsdynlz p /html[1]/body[1]/article[1]/p[135]
  `bat` tries to achieve the following goals:
0et4e257gum li /html[1]/body[1]/article[1]/ul[4]/li[1]
  Provide beautiful, advanced syntax highlighting
2eezbx2bcnw li /html[1]/body[1]/article[1]/ul[4]/li[2]
  Integrate with Git to show file modifications
11k6u8vxn32 li /html[1]/body[1]/article[1]/ul[4]/li[3]
  Be a drop-in replacement for (POSIX) `cat`
0ionls9s3yo li /html[1]/body[1]/article[1]/ul[4]/li[4]
  Offer a user-friendly command-line interface
25mm92hr2ij p /html[1]/body[1]/article[1]/p[136]
  There are a lot of alternatives, if you are looking for similar programs. See [link]this document[/link] for a comparison.
09guv56ojlo heading [h2] /html[1]/body[1]/article[1]/div[133]/h2[1]
  License
0bx4ftk7rdc p /html[1]/body[1]/article[1]/p[137]
  Copyright (c) 2018-2025 [link]bat-developers[/link].
0rhkfwtgrro p /html[1]/body[1]/article[1]/p[138]
  `bat` is made available under the terms of either the MIT License or the Apache License 2.0, at your option.
27j8q0pw9xs p /html[1]/body[1]/article[1]/p[139]
  See the [link]LICENSE-APACHE[/link] and [link]LICENSE-MIT[/link] files for license details.
