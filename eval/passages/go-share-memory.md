---
id: go-share-memory
category: tech-blog
title: Share Memory By Communicating
url: https://go.dev/blog/codelab-share
author: Andrew Gerrand
license: CC BY 4.0
note: excerpt; the struct is shortened by one field
---
Traditional threading models (commonly used when writing Java, C++, and Python programs, for example) require the programmer to communicate between threads using shared memory. Typically, shared data structures are protected by locks, and threads will contend over those locks to access the data. In some cases, this is made easier by the use of thread-safe data structures such as Python's Queue.

Go's concurrency primitives - goroutines and channels - provide an elegant and distinct means of structuring concurrent software. Instead of explicitly using locks to mediate access to shared data, Go encourages the use of channels to pass references to data between goroutines. This approach ensures that only one goroutine has access to the data at a given time. The concept is summarized in the document [Effective Go](https://go.dev/doc/effective_go.html) (a must-read for any Go programmer):

> Do not communicate by sharing memory; instead, share memory by communicating.

Consider a program that polls a list of URLs. In a traditional threading environment, one might structure its data like so:

```go
type Resource struct {
    url        string
    polling    bool
    lastError  error
}
```
