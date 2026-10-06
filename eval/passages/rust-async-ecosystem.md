---
id: rust-async-ecosystem
category: tech-blog
title: Async-await on stable Rust! (ecosystem)
url: https://blog.rust-lang.org/2019/11/07/Async-await-stable/
author: Niko Matsakis (Rust async-await working group)
license: MIT OR Apache-2.0
note: excerpt
---
**On this coming Thursday, November 7, async-await syntax hits stable Rust, as part of the 1.39.0 release.** This work has been a long time in development -- the key ideas for zero-cost futures, for example, were [first proposed by Aaron Turon and Alex Crichton in 2016](https://aturon.github.io/blog/2016/08/11/futures/)! -- and we are very proud of the end result. We believe that Async I/O is going to be an increasingly important part of Rust's story.

While this first release of "async-await" is a momentous event, it's also only the beginning. The current support for async-await marks a kind of "Minimum Viable Product" (MVP). We expect to be polishing, improving, and extending it for some time.

Now that async-await is approaching stabilization, all the major Async I/O runtimes are at work adding and extending their support for the new syntax:

- the [tokio](https://tokio.rs/) runtime [recently announced a number of scheduler improvements](https://tokio.rs/blog/2019-10-scheduler/), and they are planning a stable release in November that supports async-await syntax;
- the [async-std](https://async.rs/) runtime [has been putting out weekly releases for the past few months](https://github.com/async-rs/async-std/releases), and plans to make their 1.0 release shortly after async-await hits stable;
- using [wasm-bindgen-futures](https://docs.rs/crate/wasm-bindgen-futures/0.2.16), you can even bridge Rust Futures with [JavaScript promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises);
- the [hyper library](https://hyper.rs) has [migrated](https://github.com/hyperium/hyper/issues/1805) to adopt standard Rust futures.
