---
id: go-errors-are-values
category: tech-blog
title: Errors are values
url: https://go.dev/blog/errors-are-values
author: Rob Pike
license: CC BY 4.0
note: excerpt
---
A common point of discussion among Go programmers, especially those new to the language, is how to handle errors. The conversation often turns into a lament at the number of times the sequence

```go
if err != nil {
	return err
}
```

shows up. We recently scanned all the open source projects we could find and discovered that this snippet occurs only once per page or two, less often than some would have you believe. Still, if the perception persists that one must type `if err != nil` all the time, something must be wrong, and the obvious target is Go itself.

This is unfortunate, misleading, and easily corrected. Perhaps what is happening is that programmers new to Go ask, "How does one handle errors?", learn this pattern, and stop there. In other languages, one might use a try-catch block or other such mechanism to handle errors. Therefore, the programmer thinks, when I would have used a try-catch in my old language, I will just type `if err != nil` in Go. Over time the Go code collects many such snippets, and the result feels clumsy.

Regardless of whether this explanation fits, it is clear that these Go programmers miss a fundamental point about errors: _Errors are values._

Values can be programmed, and since errors are values, errors can be programmed.

Here's a simple example from the `bufio` package's [`Scanner`](https://pkg.go.dev/bufio#Scanner) type. Its `Scan` method performs the underlying I/O, which can of course lead to an error. Yet the `Scan` method does not expose an error at all. Instead, it returns a boolean, and a separate method, to be run at the end of the scan, reports whether an error occurred. Client code looks like this:

```go
scanner := bufio.NewScanner(input)
for scanner.Scan() {
	token := scanner.Text()
	// process token
}
if err := scanner.Err(); err != nil {
	// process the error
}
```

Sure, there is a nil check for an error, but it appears and executes only once. With the real API, the client's code therefore feels more natural: loop until done, then worry about errors. Error handling does not obscure the flow of control.
