---
id: rust-async-await-primer
category: tech-blog
title: Async-await on stable Rust!
url: https://blog.rust-lang.org/2019/11/07/Async-await-stable/
author: Niko Matsakis (Rust async-await working group)
license: MIT OR Apache-2.0
note: excerpt; Rust async passage (future/executor terminology)
---
### Async-await: a quick primer

So, what is async await? Async-await is a way to write functions that can "pause", return control to the runtime, and then pick up from where they left off. Typically those pauses are to wait for I/O, but there can be any number of uses.

To use async-await, you start by writing `async fn` instead of `fn`:

```rust
async fn first_function() -> u32 { .. }
```

Unlike a regular function, calling an `async fn` doesn't have any immediate effect. Instead, it returns a `Future`. This is a suspended computation that is waiting to be executed. To actually *execute* the future, use the `.await` operator:

```rust
async fn another_function() {
    // Create the future:
    let future = first_function();

    // Await the future, which will execute it (and suspend
    // this function if we encounter a need to wait for I/O):
    let result: u32 = future.await;
}
```

This example shows the first difference between Rust and other languages: we write `future.await` instead of `await future`. This syntax integrates better with Rust's `?` operator for propagating errors (which, after all, are very common in I/O). You can simply write `future.await?` to await the result of a future and propagate errors. It also has the advantage of making method chaining painless.

### Zero-cost futures

The other difference between Rust futures and futures in JS and C# is that they are based on a "poll" model, which makes them **zero cost**. In other languages, invoking an async function immediately creates a future and schedules it for execution: awaiting the future isn't necessary for it to execute. But this implies some overhead for each future that is created.

In contrast, in Rust, calling an async function does not do any scheduling in and of itself, which means that we can compose a complex nest of futures without incurring a per-future cost. As an end-user, though, the main thing you'll notice is that **futures feel "lazy"**: they don't do anything until you await them.
