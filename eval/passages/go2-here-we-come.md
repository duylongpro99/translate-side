---
id: go2-here-we-come
category: opinion
title: Go 2, here we come!
url: https://go.dev/blog/go2-here-we-come
author: Robert Griesemer
license: CC BY 4.0
note: excerpt
---
## Background

At GopherCon 2017, Russ Cox officially started the thought process on the next big version of Go with his talk [The Future of Go](https://www.youtube.com/watch?v=0Zbh_vmAKvk). We have called this future language informally Go 2, even though we understand now that it will arrive in incremental steps rather than with a big bang and a single major release. Still, Go 2 is a useful moniker, if only to have a way to talk about that future language, so let’s keep using it for now.

A major difference between Go 1 and Go 2 is who is going to influence the design and how decisions are made. Go 1 was a small team effort with modest outside influence; Go 2 will be much more community-driven. After almost 10 years of exposure, we have learned a lot about the language and libraries that we didn’t know in the beginning, and that was only possible through feedback from the Go community.

In 2015 we introduced the proposal process to gather a specific kind of feedback: proposals for language and library changes. A committee composed of senior Go team members has been reviewing, categorizing, and deciding on incoming proposals on a regular basis. That has worked pretty well, but as part of that process we have ignored all proposals that are not backward-compatible, simply labeling them Go 2 instead.
