---
id: go-gofmt
category: opinion
title: go fmt your code
url: https://go.dev/blog/gofmt
author: Andrew Gerrand
license: CC BY 4.0
note: excerpt
---
## Introduction

Gofmt is a tool that automatically formats Go source code.

Gofmt'd code is:

- easier to **write**: never worry about minor formatting concerns while hacking away,
- easier to **read**: when all code looks the same you need not mentally convert others' formatting style into something you can understand.
- easier to **maintain**: mechanical changes to the source don't cause unrelated changes to the file's formatting; diffs show only the real changes.
- **uncontroversial**: never have a debate about spacing or brace position ever again!
