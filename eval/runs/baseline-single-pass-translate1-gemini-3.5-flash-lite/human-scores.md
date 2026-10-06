# Human scoring sheet: single-pass / translate@1 / gemini-3.5-flash-lite

Run `2026-10-06T14-18-23-283Z`, target language `vi`. Fill in a score from 1 to 5 (whole numbers; halves are accepted) after each dimension in every passage section. Leave a line empty to skip it. Lines starting with `EN |` / `VI |` / `CODE |` are the passage; code is kept as is and not scored. Do not edit the `## <id>` headings: the report finds your scores by them.

### Rubric (1–5)

A 2 sits between the 1 and 3 anchors, a 4 between the 3 and 5 anchors.

**fidelity** — Are the meaning and intent of the source kept?
- 1: Meaning is wrong or missing in several places; content added, dropped or invented; code, URLs or markers damaged.
- 3: Main message is right, but some details are lost, softened or shifted, or one clear mistranslation.
- 5: Everything the source says is there, nothing added; code, numbers, names and links intact.

**naturalness** — Does it read like text written in the target language, not translated?
- 1: Word-for-word calques; unnatural word order; a native reader would stumble in most sentences.
- 3: Understandable and mostly grammatical, but with noticeable translationese in places.
- 5: Fluent and idiomatic throughout; a native reader would not guess it is a translation.

**tone** — Are register, voice, humor, sarcasm and attitude of the source kept?
- 1: Tone is lost or inverted: sarcasm taken literally, humor flattened, formal text made casual (or the reverse).
- 3: Register is roughly right, but the humor, irony or emphasis is weakened or only partly carried over.
- 5: Voice, register and any irony or humor come across as in the source, with idioms re-created, not translated literally.

**terminology** — Are technical terms and names rendered correctly and consistently?
- 1: Key terms are mistranslated, or one term has several different renderings within the passage.
- 3: Most terms are right, with a few awkward, inconsistent or needlessly translated ones.
- 5: Terms follow the usual usage of the target-language technical community (or are kept in English where that is the norm), and are consistent.

---

## go-errors-are-values
tech-blog · Errors are values · https://go.dev/blog/errors-are-values

EN | A common point of discussion among Go programmers, especially those new to the language, is how to handle errors. The conversation often turns into a lament at the number of times the sequence
VI | Một chủ đề thường được bàn tán sôi nổi trong cộng đồng lập trình viên Go, đặc biệt là những người mới làm quen với ngôn ngữ này, là cách xử lý lỗi. Cuộc trò chuyện thường biến thành lời phàn nàn về số lần đoạn mã

CODE | if err != nil {
CODE | 	return err
CODE | }

EN | shows up. We recently scanned all the open source projects we could find and discovered that this snippet occurs only once per page or two, less often than some would have you believe. Still, if the perception persists that one must type `if err != nil` all the time, something must be wrong, and the obvious target is Go itself.
VI | xuất hiện. Gần đây, chúng tôi đã quét tất cả các dự án mã nguồn mở có thể tìm thấy và phát hiện ra đoạn mã này chỉ xuất hiện khoảng một hoặc hai trang mới có một lần, ít hơn nhiều so với những gì người ta vẫn tưởng tượng. Dù vậy, nếu quan niệm cho rằng lúc nào cũng phải gõ `if err != nil` vẫn cứ bám rễ, thì chắc chắn có điều gì đó không ổn, và mục tiêu bị chỉ trích rõ ràng chính là bản thân ngôn ngữ Go.

EN | This is unfortunate, misleading, and easily corrected. Perhaps what is happening is that programmers new to Go ask, "How does one handle errors?", learn this pattern, and stop there. In other languages, one might use a try-catch block or other such mechanism to handle errors. Therefore, the programmer thinks, when I would have used a try-catch in my old language, I will just type `if err != nil` in Go. Over time the Go code collects many such snippets, and the result feels clumsy.
VI | Điều này thật đáng tiếc, gây hiểu lầm và rất dễ khắc phục. Có lẽ nguyên nhân là do những lập trình viên mới làm quen với Go đặt câu hỏi: "Làm thế nào để xử lý lỗi?", học theo mẫu này và dừng lại ở đó. Ở các ngôn ngữ khác, người ta có thể sử dụng khối try-catch hoặc cơ chế tương tự để xử lý lỗi. Do đó, lập trình viên nghĩ rằng, khi họ dùng try-catch ở ngôn ngữ cũ, họ chỉ cần gõ `if err != nil` trong Go. Theo thời gian, mã nguồn Go tích tụ rất nhiều đoạn như vậy, và kết quả là đem lại cảm giác vụng về.

EN | Regardless of whether this explanation fits, it is clear that these Go programmers miss a fundamental point about errors: *Errors are values.*
VI | Dù lời giải thích này có chính xác hay không, rõ ràng là những lập trình viên Go này đã bỏ sót một điểm cơ bản về lỗi: *Lỗi chính là các giá trị (Errors are values).*

EN | Values can be programmed, and since errors are values, errors can be programmed.
VI | Giá trị thì có thể được lập trình, và vì lỗi là giá trị, nên lỗi cũng có thể được lập trình.

EN | Here's a simple example from the `bufio` package's [`Scanner`](https://pkg.go.dev/bufio#Scanner) type. Its `Scan` method performs the underlying I/O, which can of course lead to an error. Yet the `Scan` method does not expose an error at all. Instead, it returns a boolean, and a separate method, to be run at the end of the scan, reports whether an error occurred. Client code looks like this:
VI | Dưới đây là một ví dụ đơn giản từ kiểu [`Scanner`](https://pkg.go.dev/bufio#Scanner) trong gói `bufio`. Phương thức `Scan` của nó thực hiện các thao tác I/O cơ bản, và tất nhiên việc này có thể dẫn đến lỗi. Thế nhưng phương thức `Scan` lại hoàn toàn không phơi bày lỗi ra ngoài. Thay vào đó, nó trả về một giá trị boolean, và một phương thức riêng biệt sẽ được chạy ở cuối quá trình quét để báo cáo xem có lỗi nào xảy ra hay không. Mã nguồn của client trông như thế này:

CODE | scanner := bufio.NewScanner(input)
CODE | for scanner.Scan() {
CODE | 	token := scanner.Text()
CODE | 	// process token
CODE | }
CODE | if err := scanner.Err(); err != nil {
CODE | 	// process the error
CODE | }

EN | Sure, there is a nil check for an error, but it appears and executes only once. With the real API, the client's code therefore feels more natural: loop until done, then worry about errors. Error handling does not obscure the flow of control.
VI | Đúng là vẫn có một bước kiểm tra nil cho lỗi, nhưng nó chỉ xuất hiện và thực thi đúng một lần. Với API thực tế, mã nguồn của client nhờ thế mà mang lại cảm giác tự nhiên hơn: lặp cho đến khi hoàn thành, rồi mới bận tâm đến lỗi. Việc xử lý lỗi không làm lu mờ luồng điều khiển.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## go-share-memory
tech-blog · Share Memory By Communicating · https://go.dev/blog/codelab-share

EN | Traditional threading models (commonly used when writing Java, C++, and Python programs, for example) require the programmer to communicate between threads using shared memory. Typically, shared data structures are protected by locks, and threads will contend over those locks to access the data. In some cases, this is made easier by the use of thread-safe data structures such as Python's Queue.
VI | Các mô hình luồng truyền thống (thường được dùng khi viết các chương trình Java, C++ và Python, chẳng hạn) yêu cầu lập trình viên phải cho các luồng giao tiếp với nhau bằng bộ nhớ chia sẻ. Thông thường, các cấu trúc dữ liệu chia sẻ được bảo vệ bằng các khóa (lock), và các luồng sẽ tranh chấp các khóa đó để truy cập dữ liệu. Trong một số trường hợp, việc này trở nên dễ dàng hơn nhờ sử dụng các cấu trúc dữ liệu an toàn cho luồng như Queue trong Python.

EN | Go's concurrency primitives - goroutines and channels - provide an elegant and distinct means of structuring concurrent software. Instead of explicitly using locks to mediate access to shared data, Go encourages the use of channels to pass references to data between goroutines. This approach ensures that only one goroutine has access to the data at a given time. The concept is summarized in the document [link]Effective Go[/link] (a must-read for any Go programmer):
VI | Các thành phần cơ bản xử lý đồng thời của Go - goroutine và channel - cung cấp một phương thức tao nhã và khác biệt để cấu trúc phần mềm đồng thời. Thay vì sử dụng tường minh các khóa để điều phối quyền truy cập vào dữ liệu chia sẻ, Go khuyến khích sử dụng channel để truyền tham chiếu đến dữ liệu giữa các goroutine. Cách tiếp cận này đảm bảo rằng chỉ có một goroutine duy nhất có quyền truy cập vào dữ liệu tại một thời điểm nhất định. Khái niệm này được tóm tắt trong tài liệu [link]Effective Go[/link] (tài liệu bắt buộc phải đọc đối với bất kỳ lập trình viên Go nào):

EN | Do not communicate by sharing memory; instead, share memory by communicating.
VI | Đừng giao tiếp bằng cách chia sẻ bộ nhớ; thay vào đó, hãy chia sẻ bộ nhớ bằng cách giao tiếp.

EN | Consider a program that polls a list of URLs. In a traditional threading environment, one might structure its data like so:
VI | Hãy xét một chương trình thực hiện thăm dò (poll) một danh sách các URL. Trong một môi trường luồng truyền thống, người ta có thể cấu trúc dữ liệu của chương trình như sau:

CODE | type Resource struct {
CODE |     url        string
CODE |     polling    bool
CODE |     lastError  error
CODE | }

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-async-await-primer
tech-blog · Async-await on stable Rust! · https://blog.rust-lang.org/2019/11/07/Async-await-stable/

EN | Async-await: a quick primer
VI | Async-await: hướng dẫn nhanh

EN | So, what is async await? Async-await is a way to write functions that can "pause", return control to the runtime, and then pick up from where they left off. Typically those pauses are to wait for I/O, but there can be any number of uses.
VI | Vậy async-await là gì? Async-await là cách viết các hàm có khả năng "tạm dừng", trả lại quyền điều khiển cho runtime, rồi tiếp tục chạy từ điểm dừng đó. Thông thường, các khoảng dừng này dùng để chờ I/O, nhưng bạn có thể dùng vào vô số việc khác.

EN | To use async-await, you start by writing `async fn` instead of `fn`:
VI | Để dùng async-await, bạn bắt đầu bằng cách viết `async fn` thay vì `fn`:

CODE | async fn first_function() -> u32 { .. }

EN | Unlike a regular function, calling an `async fn` doesn't have any immediate effect. Instead, it returns a `Future`. This is a suspended computation that is waiting to be executed. To actually *execute* the future, use the `.await` operator:
VI | Không giống hàm thông thường, việc gọi một `async fn` không gây ra hiệu ứng tức thời nào. Thay vào đó, nó trả về một `Future`. Đây là một phép tính đang tạm dừng và chờ được thực thi. Để thực sự *thực thi* future đó, hãy dùng toán tử `.await`:

CODE | async fn another_function() {
CODE |     // Create the future:
CODE |     let future = first_function();
CODE | 
CODE |     // Await the future, which will execute it (and suspend
CODE |     // this function if we encounter a need to wait for I/O):
CODE |     let result: u32 = future.await;
CODE | }

EN | This example shows the first difference between Rust and other languages: we write `future.await` instead of `await future`. This syntax integrates better with Rust's `?` operator for propagating errors (which, after all, are very common in I/O). You can simply write `future.await?` to await the result of a future and propagate errors. It also has the advantage of making method chaining painless.
VI | Ví dụ này cho thấy điểm khác biệt đầu tiên giữa Rust và các ngôn ngữ khác: chúng ta viết `future.await` thay vì `await future`. Cú pháp này tích hợp tốt hơn với toán tử `?` trong Rust dùng để lan truyền lỗi (v vốn rất phổ biến trong I/O). Bạn chỉ cần viết `future.await?` để chờ kết quả của một future và lan truyền lỗi. Nó cũng có ưu điểm là giúp việc nối chuỗi phương thức (method chaining) trở nên cực kỳ mượt mà.

EN | Zero-cost futures
VI | Future chi phí bằng không (Zero-cost futures)

EN | The other difference between Rust futures and futures in JS and C# is that they are based on a "poll" model, which makes them *zero cost*. In other languages, invoking an async function immediately creates a future and schedules it for execution: awaiting the future isn't necessary for it to execute. But this implies some overhead for each future that is created.
VI | Điểm khác biệt nữa giữa future trong Rust và trong JS hay C# là chúng dựa trên mô hình "poll" (thăm dò), giúp chúng đạt *chi phí bằng không*. Ở các ngôn ngữ khác, việc gọi một hàm async sẽ tạo ra ngay một future và lên lịch thực thi cho nó: việc await future là không bắt buộc để nó chạy. Nhưng điều này đồng nghĩa với một chút chi phí phát sinh cho mỗi future được tạo ra.

EN | In contrast, in Rust, calling an async function does not do any scheduling in and of itself, which means that we can compose a complex nest of futures without incurring a per-future cost. As an end-user, though, the main thing you'll notice is that *futures feel "lazy"*: they don't do anything until you await them.
VI | Ngược lại, trong Rust, việc gọi một hàm async tự bản thân nó không làm nhiệm vụ lên lịch nào cả, nghĩa là chúng ta có thể kết hợp một cấu trúc lồng nhau phức tạp gồm nhiều future mà không làm phát sinh chi phí trên mỗi future. Tuy nhiên, với tư cách là lập trình viên sử dụng, điều chính yếu bạn sẽ nhận thấy là *các future mang tính "lười biếng"*: chúng chẳng làm gì cả cho đến khi bạn await chúng.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-async-ecosystem
tech-blog · Async-await on stable Rust! (ecosystem) · https://blog.rust-lang.org/2019/11/07/Async-await-stable/

EN | *On this coming Thursday, November 7, async-await syntax hits stable Rust, as part of the 1.39.0 release.* This work has been a long time in development -- the key ideas for zero-cost futures, for example, were [link]first proposed by Aaron Turon and Alex Crichton in 2016[/link]! -- and we are very proud of the end result. We believe that Async I/O is going to be an increasingly important part of Rust's story.
VI | *Vào thứ Năm tuần tới, ngày 7 tháng 11, cú pháp async-await sẽ chính thức có mặt trên phiên bản Rust ổn định (stable)*, là một phần của bản phát hành 1.39.0. Công việc này đã được phát triển trong một thời gian dài -- chẳng hạn như các ý tưởng cốt lõi về future "không chi phí" (zero-cost future) đã được [link]Aaron Turon và Alex Crichton đề xuất lần đầu tiên vào năm 2016[/link]! -- và chúng tôi rất tự hào về kết quả cuối cùng. Chúng tôi tin rằng I/O bất đồng bộ (Async I/O) sẽ ngày càng trở thành một phần quan trọng trong chặng đường phát triển của Rust.

EN | While this first release of "async-await" is a momentous event, it's also only the beginning. The current support for async-await marks a kind of "Minimum Viable Product" (MVP). We expect to be polishing, improving, and extending it for some time.
VI | Mặc dù bản phát hành "async-await" đầu tiên này là một sự kiện trọng đại, nhưng nó mới chỉ là khởi điểm. Khả năng hỗ trợ async-await hiện tại đánh dấu một dạng "Sản phẩm khả dụng tối thiểu" (MVP). Chúng tôi dự kiến sẽ tiếp tục trau chuốt, cải tiến và mở rộng nó trong thời gian tới.

EN | Now that async-await is approaching stabilization, all the major Async I/O runtimes are at work adding and extending their support for the new syntax:
VI | Bây giờ, khi async-await sắp đạt đến độ ổn định, tất cả các runtime I/O bất đồng bộ lớn đều đang tích cực bổ sung và mở rộng hỗ trợ cho cú pháp mới này:

EN | the [link]tokio[/link] runtime [link]recently announced a number of scheduler improvements[/link], and they are planning a stable release in November that supports async-await syntax;
VI | runtime [link]tokio[/link] [link]gần đây đã công bố một loạt cải tiến đối với bộ lập lịch[/link], và họ đang lên kế hoạch phát hành phiên bản ổn định vào tháng 11 hỗ trợ cú pháp async-await;

EN | the [link]async-std[/link] runtime [link]has been putting out weekly releases for the past few months[/link], and plans to make their 1.0 release shortly after async-await hits stable;
VI | runtime [link]async-std[/link] [link]đã liên tục ra mắt các bản phát hành hàng tuần trong vài tháng qua[/link], và dự định tung ra phiên bản 1.0 ngay sau khi async-await chính thức có mặt trên bản ổn định;

EN | using [link]wasm-bindgen-futures[/link], you can even bridge Rust Futures with [link]JavaScript promises[/link];
VI | bằng cách sử dụng [link]wasm-bindgen-futures[/link], bạn thậm chí có thể kết nối Rust Future với [link]JavaScript promise[/link];

EN | the [link]hyper library[/link] has [link]migrated[/link] to adopt standard Rust futures.
VI | thư viện [link]hyper[/link] đã [link]chuyển đổi[/link] sang sử dụng các future chuẩn của Rust.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## so-branch-prediction
tech-blog · Why is processing a sorted array faster than processing an unsorted array? · https://stackoverflow.com/a/11227902

EN | You are a victim of branch prediction fail.
VI | Bạn đã là nạn nhân của lỗi dự đoán nhánh (branch prediction fail).

EN | What is Branch Prediction?
VI | Dự đoán nhánh là gì?

EN | Consider a railroad junction. Now for the sake of argument, suppose this is back in the 1800s - before long-distance or radio communication.
VI | Hãy tưởng tượng một nút giao đường sắt. Giả sử đây là những năm 1800 — thời điểm chưa có thông tin liên lạc tầm xa hay vô tuyến.

EN | You are a blind operator of a junction and you hear a train coming. You have no idea which way it is supposed to go. You stop the train to ask the driver which direction they want. And then you set the switch appropriately.
VI | Bạn là một gác gian đường sắt bị mù và nghe thấy một đoàn tàu đang tới. Bạn hoàn toàn không biết nó phải đi theo hướng nào. Bạn dừng đoàn tàu lại để hỏi người lái tàu muốn đi hướng nào. Rồi sau đó bạn mới chỉnh thanh chuyển ray cho phù hợp.

EN | Trains are heavy and have a lot of inertia, so they take forever to start up and slow down.
VI | Tàu hỏa rất nặng và có quán tính lớn, nên mất rất nhiều thời gian để khởi động lại cũng như giảm tốc.

EN | Is there a better way? You guess which direction the train will go! If you guessed right, it continues on. If you guessed wrong, the driver will stop, back up, and yell at you to flip the switch. Then it can restart down the other path.
VI | Có cách nào tốt hơn không? Bạn đoán xem đoàn tàu sẽ đi hướng nào! Nếu bạn đoán đúng, nó cứ thế đi tiếp. Nếu bạn đoán sai, người lái tàu sẽ dừng lại, lùi xe, và quát bạn gạt thanh chuyển ray. Sau đó tàu mới có thể khởi động lại để đi theo nhánh kia.

EN | If you guess right every time, the train will never have to stop. If you guess wrong too often, the train will spend a lot of time stopping, backing up, and restarting.
VI | Nếu bạn đoán đúng mọi lúc, đoàn tàu sẽ không bao giờ phải dừng lại. Nếu bạn đoán sai quá nhiều, đoàn tàu sẽ mất rất nhiều thời gian để dừng, lùi và khởi động lại.

EN | Consider an if-statement: At the processor level, it is a branch instruction. You are a processor and you see a branch. You have no idea which way it will go. What do you do? You halt execution and wait until the previous instructions are complete. Then you continue down the correct path.
VI | Hãy xét một câu lệnh điều kiện if: Ở cấp độ bộ vi xử lý, đó là một lệnh nhánh. Bạn là một bộ xử lý và bạn nhìn thấy một nhánh. Bạn hoàn toàn không biết nó sẽ đi theo hướng nào. Bạn làm gì? Bạn tạm dừng thực thi và chờ cho đến khi các lệnh trước đó hoàn tất. Sau đó bạn mới tiếp tục đi theo con đường đúng.

EN | This is branch prediction. I admit it's not the best analogy since the train could just signal the direction with a flag. But in computers, the processor doesn't know which direction a branch will go until the last moment.
VI | Đây chính là dự đoán nhánh. Tôi thừa nhận đây không phải là phép ẩn dụ hay ho nhất vì đoàn tàu có thể ra hiệu hướng đi bằng cờ. Nhưng trong máy tính, bộ xử lý không biết nhánh sẽ đi theo hướng nào cho đến tận phút chót.

EN | As hinted from above, the culprit is this if-statement:
VI | Như đã hé lộ ở trên, thủ phạm chính là câu lệnh if sau đây:

CODE | if (data[c] >= 128)
CODE |     sum += data[c];

EN | Notice that the data is evenly distributed between 0 and 255. When the data is sorted, roughly the first half of the iterations will not enter the if-statement. After that, they will all enter the if-statement. This is very friendly to the branch predictor since the branch consecutively goes the same direction many times.
VI | Hãy lưu ý rằng dữ liệu được phân bố đều trong khoảng từ 0 đến 255. Khi dữ liệu được sắp xếp, khoảng nửa số vòng lặp đầu tiên sẽ không lọt vào câu lệnh if. Sau đó, tất cả sẽ đều lọt vào câu lệnh if. Điều này cực kỳ thân thiện với bộ dự đoán nhánh vì nhánh liên tiếp đi theo cùng một hướng rất nhiều lần.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## docker-multistage
docs · Multi-stage builds · https://docs.docker.com/build/building/multi-stage/

EN | Multi-stage builds
VI | Build nhiều giai đoạn (Multi-stage builds)

EN | Multi-stage builds are useful to anyone who has struggled to optimize Dockerfiles while keeping them easy to read and maintain.
VI | Build nhiều giai đoạn rất hữu ích cho bất kỳ ai từng chật vật tìm cách tối ưu hóa Dockerfile mà vẫn giữ cho chúng dễ đọc và dễ bảo trì.

EN | Use multi-stage builds
VI | Sử dụng build nhiều giai đoạn

EN | With multi-stage builds, you use multiple `FROM` statements in your Dockerfile. Each `FROM` instruction can use a different base, and each of them begins a new stage of the build. You can selectively copy artifacts from one stage to another, leaving behind everything you don't want in the final image.
VI | Với build nhiều giai đoạn, bạn sử dụng nhiều lệnh `FROM` trong Dockerfile của mình. Mỗi chỉ thị `FROM` có thể sử dụng một base (hình ảnh nền) khác nhau và mỗi chỉ thị bắt đầu một giai đoạn build mới. Bạn có thể chọn lọc sao chép các sản phẩm (artifact) từ giai đoạn này sang giai đoạn khác, bỏ lại tất cả những gì bạn không muốn có trong image cuối cùng.

EN | The following Dockerfile has two separate stages: one for building a binary, and another where the binary gets copied from the first stage into the next stage.
VI | Dockerfile sau đây có hai giai đoạn riêng biệt: một giai đoạn để build tệp nhị phân (binary), và một giai đoạn khác mà tệp nhị phân được sao chép từ giai đoạn đầu sang giai đoạn tiếp theo.

CODE | # syntax=docker/dockerfile:1
CODE | FROM golang:1.24
CODE | WORKDIR /src
CODE | COPY <<EOF ./main.go
CODE | package main
CODE | 
CODE | import "fmt"
CODE | 
CODE | func main() {
CODE |   fmt.Println("hello, world")
CODE | }
CODE | EOF
CODE | RUN go build -o /bin/hello ./main.go
CODE | 
CODE | FROM scratch
CODE | COPY --from=0 /bin/hello /bin/hello
CODE | CMD ["/bin/hello"]

EN | You only need the single Dockerfile. No need for a separate build script. Just run `docker build`.
VI | Bạn chỉ cần một Dockerfile duy nhất. Không cần script build riêng. Chỉ cần chạy `docker build`.

CODE | $ docker build -t hello .

EN | The end result is a tiny production image with nothing but the binary inside. None of the build tools required to build the application are included in the resulting image.
VI | Kết quả cuối cùng là một image sản xuất cực nhỏ gọn, bên trong chỉ chứa tệp nhị phân. Không có bất kỳ công cụ nào cần thiết để build ứng dụng được bao gồm trong image kết quả.

EN | How does it work? The second `FROM` instruction starts a new build stage with the `scratch` image as its base. The `COPY --from=0` line copies just the built artifact from the previous stage into this new stage. The Go SDK and any intermediate artifacts are left behind, and not saved in the final image.
VI | Cách thức hoạt động? Chỉ thị `FROM` thứ hai bắt đầu một giai đoạn build mới với image `scratch` làm base. Dòng `COPY --from=0` chỉ sao chép sản phẩm đã được build từ giai đoạn trước vào giai đoạn mới này. Go SDK và bất kỳ sản phẩm trung gian nào đều được bỏ lại phía sau và không được lưu vào image cuối cùng.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## k8s-pods
docs · Pods · https://kubernetes.io/docs/concepts/workloads/pods/

EN | Pods
VI | Pod

EN | *Pods* are the smallest deployable units of computing that you can create and manage in Kubernetes.
VI | *Pod* là đơn vị tính toán nhỏ nhất có thể triển khai mà bạn có thể tạo và quản lý trong Kubernetes.

EN | A *Pod* (as in a pod of whales or pea pod) is a group of one or more containers, with shared storage and network resources, and a specification for how to run the containers. A Pod's contents are always co-located and co-scheduled, and run in a shared context. A Pod models an application-specific "logical host": it contains one or more application containers which are relatively tightly coupled. In non-cloud contexts, applications executed on the same physical or virtual machine are analogous to cloud applications executed on the same logical host.
VI | Một *Pod* (giống như một bầy cá voi hay một quả đậu) là một nhóm gồm một hoặc nhiều container, có chung tài nguyên lưu trữ và mạng, cùng với các thông số kỹ thuật về cách chạy các container đó. Nội dung của một Pod luôn được đặt cùng chỗ (co-located), được lên lịch cùng nhau và chạy trong một ngữ cảnh chung. Pod mô phỏng một "host logic" đặc thù của ứng dụng: nó chứa một hoặc nhiều container ứng dụng gắn kết khá chặt chẽ với nhau. Trong môi trường phi điện toán đám mây, các ứng dụng chạy trên cùng một máy vật lý hoặc máy ảo cũng tương tự như các ứng dụng đám mây chạy trên cùng một host logic.

EN | As well as application containers, a Pod can contain init containers that run during Pod startup. You can also inject ephemeral containers for debugging a running Pod.
VI | Bên cạnh các container ứng dụng, một Pod có thể chứa các init container (container khởi tạo) chạy trong quá trình khởi động Pod. Bạn cũng có thể tiêm (inject) các ephemeral container (container tạm thời) để gỡ lỗi một Pod đang chạy.

EN | What is a Pod?
VI | Pod là gì?

EN | The shared context of a Pod is a set of Linux namespaces, cgroups, and potentially other facets of isolation - the same things that isolate a container. Within a Pod's context, the individual applications may have further sub-isolations applied.
VI | Ngữ cảnh chung của một Pod là tập hợp các namespace (không gian tên) Linux, cgroup và có thể là các khía cạnh cô lập khác - chính là những yếu tố cô lập một container. Trong ngữ cảnh của Pod, các ứng dụng riêng lẻ có thể được áp dụng thêm các mức cô lập con khác.

EN | A Pod is similar to a set of containers with shared namespaces and shared filesystem volumes.
VI | Một Pod tương tự như một tập hợp các container có chung namespace và các volume (ổ đĩa) hệ thống tệp chung.

EN | Pods in a Kubernetes cluster are used in two main ways:
VI | Các Pod trong một cụm Kubernetes được sử dụng theo hai cách chính:

EN | *Pods that run a single container*. The "one-container-per-Pod" model is the most common Kubernetes use case; in this case, you can think of a Pod as a wrapper around a single container; Kubernetes manages Pods rather than managing the containers directly.
VI | *Các Pod chạy một container duy nhất*. Mô hình "mỗi Pod một container" là trường hợp sử dụng Kubernetes phổ biến nhất; trong trường hợp này, bạn có thể coi Pod như một lớp vỏ bọc xung quanh một container duy nhất; Kubernetes quản lý Pod thay vì quản lý trực tiếp các container.

EN | *Pods that run multiple containers that need to work together*. A Pod can encapsulate an application composed of [link]multiple co-located containers[/link] that are tightly coupled and need to share resources. These co-located containers form a single cohesive unit.
VI | *Các Pod chạy nhiều container cần làm việc cùng nhau*. Một Pod có thể bao bọc một ứng dụng bao gồm [link]nhiều container được đặt cùng chỗ[/link] có liên kết chặt chẽ và cần chia sẻ tài nguyên với nhau. Các container được đặt cùng chỗ này tạo thành một thể thống nhất.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## mdn-closures
docs · Closures · https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures

EN | Closures
VI | Closure

EN | A *closure* is the combination of a function bundled together (enclosed) with references to its surrounding state (the *lexical environment*). In other words, a closure gives a function access to its outer scope. In JavaScript, closures are created every time a function is created, at function creation time.
VI | Một *closure* (hàm bao đóng) là sự kết hợp giữa một hàm và các tham chiếu đến trạng thái xung quanh hàm đó (*môi trường từ vựng* - lexical environment). Nói cách khác, closure cho phép một hàm truy cập vào phạm vi bên ngoài của nó. Trong JavaScript, closure được tạo ra mỗi khi một hàm được tạo, ngay tại thời điểm tạo hàm.

EN | Lexical scoping
VI | Phạm vi từ vựng (Lexical scoping)

EN | Consider the following example code:
VI | Hãy xem xét đoạn mã ví dụ sau:

CODE | function init() {
CODE |   var name = "Mozilla"; // name is a local variable created by init
CODE |   function displayName() {
CODE |     // displayName() is the inner function, that forms a closure
CODE |     console.log(name); // use variable declared in the parent function
CODE |   }
CODE |   displayName();
CODE | }
CODE | init();

EN | `init()` creates a local variable called `name` and a function called `displayName()`. The `displayName()` function is an inner function that is defined inside `init()` and is available only within the body of the `init()` function. Note that the `displayName()` function has no local variables of its own. However, since inner functions have access to the variables of outer scopes, `displayName()` can access the variable `name` declared in the parent function, `init()`.
VI | `init()` tạo ra một biến cục bộ tên là `name` và một hàm tên là `displayName()`. Hàm `displayName()` là một hàm nội bộ được định nghĩa bên trong `init()` và chỉ có thể sử dụng được bên trong phần thân của hàm `init()`. Lưu ý rằng hàm `displayName()` không có biến cục bộ nào của riêng nó. Tuy nhiên, vì các hàm nội bộ có thể truy cập các biến ở phạm vi bên ngoài, `displayName()` có thể truy cập biến `name` được khai báo ở hàm cha `init()`.

EN | If you run this code in your console, you can see that the `console.log()` statement within the `displayName()` function successfully displays the value of the `name` variable, which is declared in its parent function. This is an example of *lexical scoping*, which describes how a parser resolves variable names when functions are nested. The word *lexical* refers to the fact that lexical scoping uses the location where a variable is declared within the source code to determine where that variable is available. Nested functions have access to variables declared in their outer scope.
VI | Nếu chạy đoạn mã này trong bảng điều khiển (console), bạn sẽ thấy câu lệnh `console.log()` bên trong hàm `displayName()` hiển thị thành công giá trị của biến `name`, được khai báo trong hàm cha của nó. Đây là một ví dụ về *phạm vi từ vựng*, mô tả cách bộ phân tích cú pháp (parser) xác định tên biến khi các hàm được lồng vào nhau. Từ *từ vựng* (lexical) đề cập đến việc phạm vi từ vựng sử dụng vị trí mà một biến được khai báo trong mã nguồn để xác định nơi biến đó có thể sử dụng được. Các hàm lồng nhau có quyền truy cập vào các biến được khai báo ở phạm vi bên ngoài của chúng.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## mdn-using-promises
docs · Using promises · https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises

EN | Using promises
VI | Sử dụng promise

EN | A `Promise` is an object representing the eventual completion or failure of an asynchronous operation. Since most people are consumers of already-created promises, this guide will explain consumption of returned promises before explaining how to create them.
VI | Một `Promise` là một đối tượng đại diện cho trạng thái hoàn thành hoặc thất bại của một thao tác bất đồng bộ (asynchronous operation) trong tương lai. Vì hầu hết chúng ta chủ yếu sử dụng các promise đã được tạo sẵn, hướng dẫn này sẽ giải thích cách tiêu thụ các promise được trả về trước khi hướng dẫn cách tự tạo ra chúng.

EN | Essentially, a promise is a returned object to which you attach callbacks, instead of passing callbacks into a function. Imagine a function, `createAudioFileAsync()`, which asynchronously generates a sound file given a configuration record and two callback functions: one called if the audio file is successfully created, and the other called if an error occurs.
VI | Về cơ bản, promise là một đối tượng được trả về mà bạn sẽ gắn các hàm callback (hàm gọi lại) vào đó, thay vì truyền các callback vào bên trong một hàm. Hãy tưởng tượng có một hàm `createAudioFileAsync()`, chịu trách nhiệm tạo một tệp âm thanh một cách bất đồng bộ dựa trên một bản ghi cấu hình và hai hàm callback: một hàm được gọi nếu tệp âm thanh được tạo thành công, và hàm còn lại được gọi nếu xảy ra lỗi.

EN | Here's some code that uses `createAudioFileAsync()`:
VI | Dưới đây là một đoạn mã sử dụng `createAudioFileAsync()`:

CODE | function successCallback(result) {
CODE |   console.log(`Audio file ready at URL: ${result}`);
CODE | }
CODE | 
CODE | function failureCallback(error) {
CODE |   console.error(`Error generating audio file: ${error}`);
CODE | }
CODE | 
CODE | createAudioFileAsync(audioSettings, successCallback, failureCallback);

EN | If `createAudioFileAsync()` were rewritten to return a promise, you would attach your callbacks to it instead:
VI | Nếu `createAudioFileAsync()` được viết lại để trả về một promise, bạn sẽ gắn các callback của mình vào promise đó thay vì truyền trực tiếp:

CODE | createAudioFileAsync(audioSettings).then(successCallback, failureCallback);

EN | This convention has several advantages. We will explore each one.
VI | Quy ước này mang lại một số ưu điểm. Chúng ta sẽ cùng khám phá từng ưu điểm một.

EN | Chaining
VI | Nối chuỗi (Chaining)

EN | A common need is to execute two or more asynchronous operations back to back, where each subsequent operation starts when the previous operation succeeds, with the result from the previous step. In the old days, doing several asynchronous operations in a row would lead to the classic [link]callback hell[/link]:
VI | Một nhu cầu phổ biến là thực hiện từ hai thao tác bất đồng bộ trở lên nối tiếp nhau, trong đó mỗi thao tác tiếp theo sẽ bắt đầu khi thao tác trước đó thành công, kèm theo kết quả từ bước trước đó. Trước đây, việc thực hiện liên tiếp nhiều thao tác bất đồng bộ sẽ dẫn đến tình trạng [link]callback hell[/link] (địa ngục callback) kinh điển:

CODE | doSomething(function (result) {
CODE |   doSomethingElse(result, function (newResult) {
CODE |     doThirdThing(newResult, function (finalResult) {
CODE |       console.log(`Got the final result: ${finalResult}`);
CODE |     }, failureCallback);
CODE |   }, failureCallback);
CODE | }, failureCallback);

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-async-executor
docs · Applied: Build an Executor (Asynchronous Programming in Rust) · https://rust-lang.github.io/async-book/02_execution/04_executor.html

EN | Applied: Build an Executor
VI | Ứng dụng: Xây dựng một Executor

EN | Rust's `Future`s are lazy: they won't do anything unless actively driven to completion. One way to drive a future to completion is to `.await` it inside an `async` function, but that just pushes the problem one level up: who will run the futures returned from the top-level `async` functions? The answer is that we need a `Future` executor.
VI | Các `Future` trong Rust có tính lười (lazy): chúng không làm gì cả trừ khi được chủ động thúc đẩy cho đến khi hoàn thành. Một cách để thúc đẩy một future hoàn thành là gọi `.await` nó bên trong một hàm `async`, nhưng cách đó chỉ đẩy vấn đề lên một cấp: ai sẽ chạy các future được trả về từ các hàm `async` cấp cao nhất? Câu trả lời là chúng ta cần một `Future` executor.

EN | `Future` executors take a set of top-level `Future`s and run them to completion by calling `poll` whenever the `Future` can make progress. Typically, an executor will `poll` a future once to start off. When `Future`s indicate that they are ready to make progress by calling `wake()`, they are placed back onto a queue and `poll` is called again, repeating until the `Future` has completed.
VI | Các `Future` executor tiếp nhận một tập hợp các `Future` cấp cao nhất và chạy chúng cho đến khi hoàn thành bằng cách gọi `poll` bất cứ khi nào `Future` có thể tiến triển. Thông thường, một executor sẽ `poll` một future một lần để khởi động. Khi các `Future` báo hiệu rằng chúng đã sẵn sàng tiến triển bằng cách gọi `wake()`, chúng được đưa trở lại hàng đợi và `poll` lại được gọi, lặp lại cho đến khi `Future` hoàn thành.

EN | In this section, we'll write our own simple executor capable of running a large number of top-level futures to completion concurrently.
VI | Trong phần này, chúng ta sẽ viết một executor đơn giản của riêng mình có khả năng chạy đồng thời một lượng lớn các future cấp cao nhất cho đến khi hoàn thành.

EN | For this example, we depend on the `futures` crate for the `ArcWake` trait, which provides an easy way to construct a `Waker`. Edit `Cargo.toml` to add a new dependency:
VI | Đối với ví dụ này, chúng ta phụ thuộc vào crate `futures` để sử dụng trait `ArcWake`, cung cấp một cách dễ dàng để xây dựng `Waker`. Hãy chỉnh sửa `Cargo.toml` để thêm một dependency mới:

CODE | [package]
CODE | name = "timer_future"
CODE | version = "0.1.0"
CODE | authors = ["XYZ Author"]
CODE | edition = "2021"
CODE | 
CODE | [dependencies]
CODE | futures = "0.3"

EN | Our executor will work by sending tasks to run over a channel. The executor will pull events off of the channel and run them. When a task is ready to do more work (is awoken), it can schedule itself to be polled again by putting itself back onto the channel.
VI | Executor của chúng ta sẽ hoạt động bằng cách gửi các tác vụ cần chạy qua một channel. Executor sẽ lấy các sự kiện ra khỏi channel và chạy chúng. Khi một tác vụ sẵn sàng làm thêm việc (được đánh thức), nó có thể lên lịch để được `poll` lại bằng cách tự đưa chính nó trở lại channel.

EN | In this design, the executor itself just needs the receiving end of the task channel. The user will get a sending end so that they can spawn new futures. Tasks themselves are just futures that can reschedule themselves, so we'll store them as a future paired with a sender that the task can use to requeue itself.
VI | Trong thiết kế này, bản thân executor chỉ cần đầu nhận (receiving end) của channel tác vụ. Người dùng sẽ nhận được đầu gửi (sending end) để họ có thể spawn các future mới. Bản thân các tác vụ chỉ đơn giản là các future có thể tự lên lịch lại, vì vậy chúng ta sẽ lưu trữ chúng dưới dạng một future được ghép đôi với một sender mà tác vụ có thể dùng để tự đưa mình vào lại hàng đợi.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-book-ownership
docs · What Is Ownership? · https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html

EN | What Is Ownership?
VI | Ownership (Quyền sở hữu) là gì?

EN | *Ownership* is a set of rules that govern how a Rust program manages memory. All programs have to manage the way they use a computer’s memory while running. Some languages have garbage collection that regularly looks for no-longer-used memory as the program runs; in other languages, the programmer must explicitly allocate and free the memory. Rust uses a third approach: Memory is managed through a system of ownership with a set of rules that the compiler checks. If any of the rules are violated, the program won’t compile. None of the features of ownership will slow down your program while it’s running.
VI | *Ownership* là tập hợp các quy tắc quản lý cách một chương trình Rust quản lý bộ nhớ. Tất cả các chương trình đều phải quản lý cách chúng sử dụng bộ nhớ máy tính trong khi chạy. Một số ngôn ngữ có tính năng dọn rác (garbage collection) thường xuyên tìm kiếm bộ nhớ không còn được sử dụng khi chương trình chạy; ở các ngôn ngữ khác, lập trình viên phải tự cấp phát và giải phóng bộ nhớ một cách tường minh. Rust sử dụng cách tiếp cận thứ ba: Bộ nhớ được quản lý thông qua một hệ thống quyền sở hữu với một tập hợp các quy tắc do trình biên dịch kiểm tra. Nếu vi phạm bất kỳ quy tắc nào, chương trình sẽ không thể biên dịch. Không có tính năng nào của quyền sở hữu làm chậm chương trình của bạn trong quá trình chạy.

EN | Because ownership is a new concept for many programmers, it does take some time to get used to. The good news is that the more experienced you become with Rust and the rules of the ownership system, the easier you’ll find it to naturally develop code that is safe and efficient. Keep at it!
VI | Vì ownership là một khái niệm mới đối với nhiều lập trình viên, nên bạn sẽ cần một chút thời gian để làm quen. Tin vui là càng có nhiều kinh nghiệm với Rust và các quy tắc của hệ thống ownership, bạn sẽ càng thấy dễ dàng hơn trong việc tự nhiên viết ra mã nguồn vừa an toàn vừa hiệu quả. Cố gắng lên nhé!

EN | Both the stack and the heap are parts of memory available to your code to use at runtime, but they are structured in different ways. The stack stores values in the order it gets them and removes the values in the opposite order. This is referred to as *last in, first out (LIFO)*. Think of a stack of plates: When you add more plates, you put them on top of the pile, and when you need a plate, you take one off the top. Adding or removing plates from the middle or bottom wouldn’t work as well!
VI | Cả stack (ngăn xếp) và heap (vùng nhớ động) đều là các phần bộ nhớ sẵn có để mã nguồn của bạn sử dụng tại thời điểm chạy, nhưng chúng có cấu trúc khác nhau. Stack lưu trữ các giá trị theo thứ tự nhận được và xóa các giá trị theo thứ tự ngược lại. Điều này được gọi là *vào sau, ra trước (last in, first out - LIFO)*. Hãy tưởng tượng một chồng đĩa: Khi bạn thêm đĩa, bạn đặt chúng lên đỉnh chồng, và khi cần một đĩa, bạn lấy nó ra từ phía trên cùng. Việc thêm hoặc lấy đĩa ở giữa hay ở đáy sẽ không khả thi bằng!

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-book-panic
docs · To panic! or Not to panic! · https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html

EN | To `panic!` or Not to `panic!`
VI | Nên hay không nên dùng `panic!`?

EN | So, how do you decide when you should call `panic!` and when you should return `Result`? When code panics, there’s no way to recover. You could call `panic!` for any error situation, whether there’s a possible way to recover or not, but then you’re making the decision that a situation is unrecoverable on behalf of the calling code. When you choose to return a `Result` value, you give the calling code options. The calling code could choose to attempt to recover in a way that’s appropriate for its situation, or it could decide that an `Err` value in this case is unrecoverable, so it can call `panic!` and turn your recoverable error into an unrecoverable one. Therefore, returning `Result` is a good default choice when you’re defining a function that might fail.
VI | Vậy, làm sao để quyết định khi nào nên gọi `panic!` và khi nào nên trả về `Result`? Khi mã lệnh gặp lỗi nghiêm trọng (panic), không có cách nào để khôi phục. Bạn có thể gọi `panic!` cho mọi tình huống lỗi, dù có cách khôi phục được hay không, nhưng khi đó bạn đang thay mặt mã gọi hàm để quyết định rằng tình huống đó là không thể cứu vãn. Khi bạn chọn trả về một giá trị `Result`, bạn đang trao quyền lựa chọn cho mã gọi hàm. Mã gọi hàm có thể chọn cách khôi phục phù hợp với hoàn cảnh của nó, hoặc nó có thể quyết định rằng một giá trị `Err` trong trường hợp này là không thể cứu vãn, và thế là nó có thể gọi `panic!` để biến lỗi có thể khôi phục của bạn thành lỗi không thể khôi phục. Do đó, trả về `Result` là lựa chọn mặc định tốt khi bạn đang định nghĩa một hàm có thể gặp lỗi.

EN | In situations such as examples, prototype code, and tests, it’s more appropriate to write code that panics instead of returning a `Result`.
VI | Trong các tình huống như viết ví dụ, mã nguyên mẫu (prototype code) và các bài kiểm thử (test), việc viết mã lệnh gây panic thay vì trả về `Result` sẽ thích hợp hơn.

EN | Examples, Prototype Code, and Tests
VI | Ví dụ, Mã nguyên mẫu và Bài kiểm thử

EN | When you’re writing an example to illustrate some concept, also including robust error-handling code can make the example less clear. In examples, it’s understood that a call to a method like `unwrap` that could panic is meant as a placeholder for the way you’d want your application to handle errors, which can differ based on what the rest of your code is doing.
VI | Khi bạn viết một ví dụ để minh họa cho một khái niệm nào đó, việc chèn thêm mã xử lý lỗi cồng kềnh có thể làm ví dụ kém phần dễ hiểu. Trong các ví dụ, mọi người đều ngầm hiểu rằng việc gọi một phương thức có thể gây panic như `unwrap` chỉ đóng vai trò là phần giữ chỗ cho cách mà bạn muốn ứng dụng của mình xử lý lỗi sau này — vốn có thể thay đổi tùy thuộc vào những gì phần còn lại của mã nguồn đang làm.

EN | Similarly, the `unwrap` and `expect` methods are very handy when you’re prototyping and you’re not yet ready to decide how to handle errors. They leave clear markers in your code for when you’re ready to make your program more robust.
VI | Tương tự, các phương thức `unwrap` và `expect` rất tiện dụng khi bạn đang làm nguyên mẫu (prototyping) và chưa sẵn sàng quyết định cách xử lý lỗi. Chúng để lại các dấu hiệu rõ ràng trong mã nguồn để bạn nhận biết khi nào mình đã sẵn sàng làm cho chương trình trở nên chỉn chu hơn.

EN | If a method call fails in a test, you’d want the whole test to fail, even if that method isn’t the functionality under test. Because `panic!` is how a test is marked as a failure, calling `unwrap` or `expect` is exactly what should happen.
VI | Nếu một lời gọi phương thức thất bại trong bài kiểm thử, bạn sẽ muốn toàn bộ bài kiểm thử đó thất bại, ngay cả khi phương thức đó không phải là tính năng đang được kiểm thử. Vì `panic!` chính là cách đánh dấu một bài kiểm thử là thất bại, nên việc gọi `unwrap` hay `expect` hoàn toàn là điều nên làm.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-not-a-dictionary
docs · Wikipedia:Wikipedia is not a dictionary · https://en.wikipedia.org/wiki/Wikipedia:Wikipedia_is_not_a_dictionary

EN | Wikipedia is not a dictionary, phrasebook, or a slang, jargon, or usage guide. Instead, the goal of this project is to create an encyclopedia. Our sister project Wiktionary aims to create a dictionary. It is the "lexical companion to Wikipedia", and the two often link to each other. Wiktionary welcomes all editors who wish to write a dictionary.
VI | Wikipedia không phải là một cuốn từ điển, sách cụm từ, hay cẩm nang về tiếng lóng, biệt ngữ hay cách dùng từ. Thay vào đó, mục tiêu của dự án này là xây dựng một bộ bách khoa toàn thư. Dự án chị em của chúng ta là Wiktionary hướng tới việc tạo ra một cuốn từ điển. Đây là "bạn đồng hành về từ vựng của Wikipedia", và hai trang này thường liên kết với nhau. Wiktionary chào đón tất cả các biên tập viên muốn viết từ điển.

EN | Both dictionary entries at Wiktionary and encyclopedia articles at Wikipedia may start as stubs, but they are works in progress, to be expanded. Wikipedia articles should begin with a good definition, but they should provide other types of information about that topic as well. The full articles that Wikipedia's stubs grow into are very different from dictionary entries.
VI | Cả mục từ trên Wiktionary và bài viết bách khoa toàn thư trên Wikipedia đều có thể bắt đầu bằng các bài sơ khai, nhưng chúng là những tác phẩm đang được hoàn thiện và sẽ còn được mở rộng. Các bài viết trên Wikipedia nên bắt đầu bằng một định nghĩa hay, nhưng chúng cũng cần cung cấp các loại thông tin khác về chủ đề đó. Các bài viết đầy đủ phát triển từ các bài sơ khai của Wikipedia rất khác biệt so với các mục từ trong từ điển.

EN | Each article in an encyclopedia is about a person, people, a concept, a place, an event, a thing, etc., whereas a dictionary entry is primarily about a word, an idiom, or a term and its meaning(s), usage and history.
VI | Mỗi bài viết trong bách khoa toàn thư nói về một cá nhân, một nhóm người, một khái niệm, một địa điểm, một sự kiện, một sự vật, v.v., trong khi một mục từ trong từ điển chủ yếu nói về một từ, một thành ngữ, hoặc một thuật ngữ cùng với (các) ý nghĩa, cách dùng và lịch sử của chúng.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## go-gofmt
opinion · go fmt your code · https://go.dev/blog/gofmt

EN | Introduction
VI | Giới thiệu

EN | Gofmt is a tool that automatically formats Go source code.
VI | Gofmt là một công cụ tự động định dạng mã nguồn Go.

EN | Gofmt'd code is:
VI | Mã nguồn được định dạng bởi Gofmt sẽ:

EN | easier to *write*: never worry about minor formatting concerns while hacking away,
VI | dễ *viết* hơn: không bao giờ phải bận tâm về những vấn đề định dạng vụn vặt khi đang say sưa viết mã,

EN | easier to *read*: when all code looks the same you need not mentally convert others' formatting style into something you can understand.
VI | dễ *đọc* hơn: khi mọi mã nguồn đều trông giống nhau, bạn không cần phải tốn công chuyển đổi phong cách định dạng của người khác sang kiểu mà bạn có thể hiểu được.

EN | easier to *maintain*: mechanical changes to the source don't cause unrelated changes to the file's formatting; diffs show only the real changes.
VI | dễ *bảo trì* hơn: các thay đổi cơ học đối với mã nguồn không gây ra những thay đổi không liên quan đến định dạng của tệp; các bản diff chỉ hiển thị những thay đổi thực tế.

EN | *uncontroversial*: never have a debate about spacing or brace position ever again!
VI | *không còn gì để bàn cãi*: không bao giờ phải tranh luận về khoảng trắng hay vị trí dấu ngoặc nhọn nữa!

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## go2-here-we-come
opinion · Go 2, here we come! · https://go.dev/blog/go2-here-we-come

EN | Background
VI | Bối cảnh

EN | At GopherCon 2017, Russ Cox officially started the thought process on the next big version of Go with his talk [link]The Future of Go[/link]. We have called this future language informally Go 2, even though we understand now that it will arrive in incremental steps rather than with a big bang and a single major release. Still, Go 2 is a useful moniker, if only to have a way to talk about that future language, so let’s keep using it for now.
VI | Tại GopherCon 2017, Russ Cox đã chính thức khơi mào quá trình suy ngẫm về phiên bản lớn tiếp theo của Go với bài thuyết trình [link]The Future of Go[/link]. Chúng ta vẫn thường gọi tương lai ấy là Go 2, mặc dù giờ đây ai cũng hiểu rằng nó sẽ đến qua từng bước cải tiến nhỏ thay vì một cú nổ lớn với một bản phát hành chính thức duy nhất. Dù sao đi nữa, Go 2 vẫn là một cái tên hữu ích, chí ít là để chúng ta có một cách gọi về ngôn ngữ trong tương lai đó, nên cứ tiếp tục dùng nó trong lúc này nhé.

EN | A major difference between Go 1 and Go 2 is who is going to influence the design and how decisions are made. Go 1 was a small team effort with modest outside influence; Go 2 will be much more community-driven. After almost 10 years of exposure, we have learned a lot about the language and libraries that we didn’t know in the beginning, and that was only possible through feedback from the Go community.
VI | Một điểm khác biệt lớn giữa Go 1 và Go 2 là ai sẽ là người tác động đến thiết kế và các quyết định được đưa ra như thế nào. Go 1 là nỗ lực của một nhóm nhỏ với sự ảnh hưởng từ bên ngoài rất khiêm tốn; còn Go 2 sẽ mang tính cộng đồng cao hơn nhiều. Sau gần 10 năm tiếp xúc, chúng ta đã đúc rút được rất nhiều điều về ngôn ngữ và thư viện mà thuở ban đầu chúng ta chưa hề biết, và điều đó chỉ có được nhờ những phản hồi từ cộng đồng Go.

EN | In 2015 we introduced the proposal process to gather a specific kind of feedback: proposals for language and library changes. A committee composed of senior Go team members has been reviewing, categorizing, and deciding on incoming proposals on a regular basis. That has worked pretty well, but as part of that process we have ignored all proposals that are not backward-compatible, simply labeling them Go 2 instead.
VI | Vào năm 2015, chúng tôi đã giới thiệu quy trình đề xuất nhằm thu thập một loại phản hồi cụ thể: các đề xuất thay đổi ngôn ngữ và thư viện. Một ủy ban bao gồm các thành viên kỳ cựu của nhóm phát triển Go đã và đang xem xét, phân loại và đưa ra quyết định đối với các đề xuất gửi đến một cách thường xuyên. Phương thức này đã hoạt động khá hiệu quả, nhưng trong khuôn khổ quy trình đó, chúng tôi đã bỏ qua mọi đề xuất không tương thích ngược, mà chỉ đơn giản gắn mác chúng là Go 2.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-dont-bite-newcomers
opinion · Wikipedia:Please do not bite the newcomers · https://en.wikipedia.org/wiki/Wikipedia:Please_do_not_bite_the_newcomers

EN | Wikipedia is improved through the work of both regular editors and newcomers. All of us were new editors once, and in some areas, the most experienced are still regarded as newcomers. Treat newcomers with kindness and patience—nothing scares valuable contributors away faster than hostility.
VI | Wikipedia được cải thiện nhờ sự đóng góp của cả các biên tập viên thường trực lẫn người mới. Tất cả chúng ta từng là người mới, và ở một số lĩnh vực, những người giàu kinh nghiệm nhất đôi khi vẫn được xem là người mới. Hãy đối xử với những người mới bằng sự tử tế và kiên nhẫn—không gì khiến những đóng góp giá trị bỏ chạy nhanh hơn thái độ thù địch.

EN | The first edits of many currently experienced editors were test edits, unsourced and/or unencyclopedic additions. As a result, it is unlikely for a new editor to be familiar with Wikipedia's markup language and its policies, guidelines, and community standards. Not having a clue is a normal stage in the editor life cycle. We want editors to survive the process.
VI | Những chỉnh sửa đầu tiên của nhiều biên tập viên kỳ cựu hiện nay từng là các chỉnh sửa thử nghiệm, những nội dung thiếu nguồn và/hoặc không mang tính bách khoa. Do đó, khó mà kỳ vọng một biên tập viên mới đã quen thuộc với ngôn ngữ đánh dấu của Wikipedia cũng như các chính sách, hướng dẫn và chuẩn mực cộng đồng của nền tảng này. Việc chưa nắm rõ mọi thứ là một giai đoạn bình thường trong quá trình gắn bó của một biên tập viên. Chúng ta đều muốn các biên tập viên có thể vượt qua giai đoạn này một cách suôn sẻ.

EN | Initial interactions set the expectation for the entire community. A welcoming atmosphere invites new editors to mature, while a harsh one fosters an idea that Wikipedia is unkind and rigid.
VI | Những tương tác ban đầu sẽ định hình kỳ vọng của họ đối với toàn bộ cộng đồng. Một bầu không khí cởi mở sẽ thu hút các biên tập viên mới trưởng thành, trong khi một thái độ gay gắt sẽ củng cố ý nghĩ rằng Wikipedia thật cay nghiệt và cứng nhắc.

EN | Next time you feel frustrated with a newcomer's mistake, take it as an opportunity to nurture potential contributors. Consider improving upon a newcomer's edit rather than reverting it. Wikipedia needs a constant stream of new information, experience, and ideas. Guide newcomers patiently and thoroughly: kindness and patience is a necessity for Wikipedia's survival.
VI | Lần tới khi bạn cảm thấy bực bội trước sai sót của người mới, hãy xem đó là cơ hội để vun đắp cho những cộng tác viên tiềm năng. Hãy cân nhắc việc cải thiện chỉnh sửa của người mới thay vì lùi lại (revert) nó. Wikipedia luôn cần một dòng chảy liên tục các thông tin, kinh nghiệm và ý tưởng mới. Hãy hướng dẫn người mới một cách kiên nhẫn và thấu đáo: sự tử tế và kiên nhẫn là điều kiện thiết yếu để Wikipedia duy trì và phát triển.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-template-regulars
opinion · Wikipedia:Don't template the regulars · https://en.wikipedia.org/wiki/Wikipedia:Don%27t_template_the_regulars

EN | Wikipedia offers many user talk templates to warn users about possible violations of vandalism, the three-revert rule, and other policies and guidelines. You should use these templates carefully.
VI | Wikipedia cung cấp rất nhiều mẫu tin nhắn trang thảo luận để cảnh báo người dùng về các hành vi có nguy cơ vi phạm quy định phá hoại, quy tắc ba lần lùi sửa, cùng các chính sách và hướng dẫn khác. Bạn nên sử dụng những mẫu này một cách cẩn trọng.

EN | These templates explain the various policies to new editors. When novice editors breach policies, it is quite possible (if we assume good faith, which we must) that they are unaware of them, and educating them is helpful. On the other hand, most editors who have been around for a while are aware of these policies. If you believe that they have broken (or are about to breach) one, it may be the result of some disagreement over the interpretation of the policy, or temporarily heated tempers. In such situations, the "did you know we had a policy here" approach can be counterproductive in resolving the issue, as it can be construed as being patronising and uncivil.
VI | Các mẫu này giúp giải thích các chính sách khác nhau cho thành viên mới. Khi các thành viên mới vi phạm quy định, rất có thể (nếu chúng ta thiện chí, điều mà ta buộc phải làm) là họ chưa biết đến những quy định đó, và việc hướng dẫn họ là rất hữu ích. Mặt khác, hầu hết các thành viên đã hoạt động lâu năm đều đã nắm rõ các chính sách này. Nếu bạn cho rằng họ đã vi phạm (hoặc sắp vi phạm) một chính sách nào đó, nguyên nhân có thể là do bất đồng về cách giải thích quy định, hoặc do cái đầu đang nóng lên nhất thời. Trong những tình huống như vậy, cách tiếp cận kiểu "bạn có biết chúng tôi có quy định này ở đây không" có thể phản tác dụng trong việc giải quyết vấn đề, bởi nó có thể bị coi là bề trên và thiếu văn minh.

EN | The problem with templated messages
VI | Vấn đề với các tin nhắn dạng mẫu

EN | Template warnings are very generic, and sometimes out of date. Sometimes a template says never to do something which is nevertheless allowed in certain circumstances. Theoretically speaking, all things are allowed in some conceivable circumstance under Ignore All Rules. Sometimes Wikipedia has multiple policies which are contradictory. If a policy violation is not clear-cut, an amicable resolution to the problem is going to require a human explanation, not an automated template.
VI | Các cảnh báo bằng mẫu rất chung chung, và đôi khi đã lỗi thời. Đôi khi một mẫu tuyên bố không bao giờ được làm điều gì đó nhưng thực chất việc đó lại được phép trong một số hoàn cảnh nhất định. Về mặt lý thuyết, mọi thứ đều được phép trong một hoàn cảnh có thể tưởng tượng được nào đó theo quy định Hãy bỏ qua mọi quy tắc. Đôi khi Wikipedia có nhiều chính sách mâu thuẫn với nhau. Nếu một hành vi vi phạm chính sách không rõ ràng rành mạch, để giải quyết vấn đề một cách êm thấm thì cần phải có lời giải thích từ con người, chứ không phải một mẫu tự động.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## bierce-devils-dictionary
humor · The Devil's Dictionary (selected entries) · https://www.gutenberg.org/ebooks/972

EN | BORE, n. A person who talks when you wish him to listen.
VI | KẺ LẮM CHUYỆN, d.t. Kẻ nói chuyện khi bạn muốn hắn lắng nghe.

EN | CYNIC, n. A blackguard whose faulty vision sees things as they are, not as they ought to be. Hence the custom among the Scythians of plucking out a cynic's eyes to improve his vision.
VI | KẺ HOÀI NGHI, d.t. Một tên khốn có tầm nhìn lệch lạc, nhìn sự việc đúng như bản chất của chúng chứ không phải như lẽ ra chúng phải thế. Thế nên người Scythia mới có tục lệ khoét mắt kẻ hoài nghi để giúp hắn nhìn rõ hơn.

EN | DIPLOMACY, n. The patriotic art of lying for one's country.
VI | NGOẠI GIAO, d.t. Nghệ thuật ái quốc là nói dối vì đất nước mình.

EN | HAPPINESS, n. An agreeable sensation arising from contemplating the misery of another.
VI | HẠNH PHÚC, d.t. Cảm giác dễ chịu phát sinh khi ngắm nhìn sự bất hạnh của kẻ khác.

EN | LAWYER, n. One skilled in circumvention of the law.
VI | LUẬT SƯ, d.t. Người thành thạo việc lách luật.

EN | POLITICS, n. A strife of interests masquerading as a contest of principles. The conduct of public affairs for private advantage.
VI | CHÍNH TRỊ, d.t. Một cuộc tranh giành lợi ích nhưng khoác áo tranh đấu vì nguyên tắc. Việc điều hành công việc chung vì tư lợi.

EN | POLITICIAN, n. An eel in the fundamental mud upon which the superstructure of organized society is reared. When he wriggles he mistakes the agitation of his tail for the trembling of the edifice.
VI | CHÍNH TRỊ GIA, d.t. Một con lươn nằm trong thứ bùn tơi xốp nền tảng làm nên kiến trúc thượng tầng của xã hội có tổ chức. Khi quẫy đuôi, hắn cứ tưởng sự rung lắc của cái đuôi chính là cơn chấn động của cả tòa nhà.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## pep20-zen
humor · PEP 20 – The Zen of Python · https://peps.python.org/pep-0020/

EN | The Zen of Python
VI | Thiền về Python

EN | Long time Pythoneer Tim Peters succinctly channels the BDFL's guiding principles for Python's design into 20 aphorisms, only 19 of which have been written down.
VI | Lập trình viên Python lâu năm Tim Peters đã cô đọng các nguyên tắc chỉ đạo thiết kế Python của BDFL thành 20 châm ngôn, nhưng mới chỉ có 19 châm ngôn được viết ra.

EN | Beautiful is better than ugly.
VI | Đẹp tốt hơn xấu.

EN | Explicit is better than implicit.
VI | Rõ ràng tốt hơn ngầm định.

EN | Simple is better than complex.
VI | Đơn giản tốt hơn phức tạp.

EN | Complex is better than complicated.
VI | Phức tạp tốt hơn rắc rối.

EN | Flat is better than nested.
VI | Phẳng tốt hơn lồng nhau.

EN | Sparse is better than dense.
VI | Thưa thớt tốt hơn dày đặc.

EN | Readability counts.
VI | Tính dễ đọc là quan trọng.

EN | Special cases aren't special enough to break the rules.
VI | Các trường hợp đặc biệt chưa đủ đặc biệt để phá vỡ quy tắc.

EN | Although practicality beats purity.
VI | Mặc dù tính thực tế thắng tính thuần khiết.

EN | Errors should never pass silently.
VI | Lỗi không bao giờ được bỏ qua trong im lặng.

EN | Unless explicitly silenced.
VI | Trừ khi được chủ động làm cho im lặng.

EN | In the face of ambiguity, refuse the temptation to guess.
VI | Khi đối mặt với sự mơ hồ, hãy từ chối cám dỗ đoán mò.

EN | There should be one-- and preferably only one --obvious way to do it.
VI | Nên có một -- và tốt nhất là chỉ một -- cách hiển nhiên để làm việc đó.

EN | Although that way may not be obvious at first unless you're Dutch.
VI | Mặc dù cách đó có lẽ không hiển nhiên ngay từ đầu trừ khi bạn là người Hà Lan.

EN | Now is better than never.
VI | Làm bây giờ tốt hơn không bao giờ.

EN | Although never is often better than *right* now.
VI | Mặc dù không bao giờ thường tốt hơn là làm *ngay* bây giờ.

EN | If the implementation is hard to explain, it's a bad idea.
VI | Nếu việc triển khai khó giải thích, đó là một ý tưởng tồi.

EN | If the implementation is easy to explain, it may be a good idea.
VI | Nếu việc triển khai dễ giải thích, đó có thể là một ý tưởng hay.

EN | Namespaces are one honking great idea -- let's do more of those!
VI | Không gian tên (namespace) là một ý tưởng tuyệt vời -- hãy dùng chúng nhiều hơn!

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## so-regex-html
humor · RegEx match open tags except XHTML self-contained tags · https://stackoverflow.com/a/1732454

EN | You can't parse [X]HTML with regex. Because HTML can't be parsed by regex. Regex is not a tool that can be used to correctly parse HTML. As I have answered in HTML-and-regex questions here so many times before, the use of regex will not allow you to consume HTML. Regular expressions are a tool that is insufficiently sophisticated to understand the constructs employed by HTML. HTML is not a regular language and hence cannot be parsed by regular expressions. Regex queries are not equipped to break down HTML into its meaningful parts. Even enhanced irregular regular expressions as used by Perl are not up to the task of parsing HTML. You will never make me crack. HTML is a language of sufficient complexity that it cannot be parsed by regular expressions. Even Jon Skeet cannot parse HTML using regular expressions. Every time you attempt to parse HTML with regular expressions, the unholy child weeps the blood of virgins, and Russian hackers pwn your webapp. Parsing HTML with regex summons tainted souls into the realm of the living. HTML and regex go together like love, marriage, and ritual infanticide. The `<center>` cannot hold it is too late. The force of regex and HTML together in the same conceptual space will destroy your mind like so much watery putty.
VI | Bạn không thể phân tích cú pháp [X]HTML bằng regex. Vì HTML không thể được phân tích bằng regex. Regex không phải là công cụ có thể dùng để phân tích cú pháp HTML một cách chính xác. Như tôi đã trả lời trong các câu hỏi về HTML-and-regex ở đây rất nhiều lần trước đây, việc dùng regex sẽ không giúp bạn xử lý nổi HTML. Biểu thức chính quy là một công cụ chưa đủ tinh vi để hiểu được các cấu trúc mà HTML sử dụng. HTML không phải là một ngôn ngữ chính quy và do đó không thể được phân tích bằng biểu thức chính quy. Các truy vấn regex không đủ trang bị để bóc tách HTML thành các thành phần có ý nghĩa của nó. Ngay cả các biểu thức chính quy bất thường được tăng cường như trong Perl cũng không với tới được nhiệm vụ phân tích HTML. Bạn sẽ không bao giờ khiến tôi khuất phục đâu. HTML là một ngôn ngữ có độ phức tạp đủ lớn để không thể bị phân tích bởi các biểu thức chính quy. Ngay cả Jon Skeet cũng không thể phân tích HTML bằng biểu thức chính quy. Mỗi khi bạn cố gắng phân tích HTML bằng biểu thức chính quy, đứa con của quỷ dữ lại rỉ máu trinh nữ, và các hacker Nga chiếm quyền điều khiển webapp của bạn. Phân tích HTML bằng regex triệu hồi những linh hồn ô uế vào cõi người sống. HTML và regex đi chung với nhau cũng hợp như tình yêu, hôn nhân, và nghi lễ sát hại trẻ sơ sinh. Thẻ `<center>` không giữ được nữa đâu, quá muộn rồi. Sức mạnh của regex và HTML kết hợp trong cùng một không gian tư duy sẽ hủy hoại tâm trí bạn tơi bời như mác-ma loãng vậy.

EN | Have you tried using an XML parser instead?
VI | Bạn đã thử dùng một trình phân tích cú pháp XML thay thế chưa?

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## swift-modest-proposal
humor · A Modest Proposal (closing section) · https://www.gutenberg.org/ebooks/1080

EN | I can think of no one objection, that will possibly be raised against this proposal, unless it should be urged, that the number of people will be thereby much lessened in the kingdom. This I freely own, and was indeed one principal design in offering it to the world. I desire the reader will observe, that I calculate my remedy for this one individual Kingdom of Ireland, and for no other that ever was, is, or, I think, ever can be upon Earth. Therefore let no man talk to me of other expedients: Of taxing our absentees at five shillings a pound: Of using neither clothes, nor houshold furniture, except what is of our own growth and manufacture: Of utterly rejecting the materials and instruments that promote foreign luxury: Of curing the expensiveness of pride, vanity, idleness, and gaming in our women: Of introducing a vein of parsimony, prudence and temperance: Of learning to love our country, wherein we differ even from Laplanders, and the inhabitants of Topinamboo: Of being a little cautious not to sell our country and consciences for nothing: Of teaching landlords to have at least one degree of mercy towards their tenants.
VI | Tôi không nghĩ ra bất kỳ sự phản đối nào có thể được đưa ra đối với đề xuất này, ngoại trừ việc người ta có thể nài nỉ rằng số lượng dân chúng trong vương quốc sẽ vì thế mà giảm đi nhiều. Điều này tôi hoàn toàn thừa nhận, và quả thực đó cũng là một trong những mục đích chính khi tôi đưa nó ra trước công chúng. Tôi mong độc giả lưu ý rằng tôi tính toán phương thuốc của mình chỉ dành riêng cho Vương quốc Ireland đơn lẻ này, chứ không dành cho bất kỳ nơi nào khác từng có, đang có, hoặc theo tôi là có thể có trên Trái Đất. Do đó, đừng ai nói với tôi về những giải pháp thay thế khác: Nào là đánh thuế năm shilling một bảng đối với những kẻ vắng mặt ở quê nhà; nào là không dùng quần áo hay đồ đạc trong nhà nào ngoài những thứ do chính chúng ta nuôi trồng và sản xuất; nào là kiên quyết từ chối nguyên liệu và dụng cụ cổ súy cho sự xa xỉ ngoại kiều; nào là chữa trị thói tốn kém của sự kiêu căng, phô trương, lười biếng và cờ bạc ở phụ nữ chúng ta; nào là tạo ra một làn sóng tằn tiện, thận trọng và điều độ; nào là học cách yêu đất nước mình, điểm mà chúng ta thậm chí khác biệt với cả người Lapland và cư dân Topinamboo; nào là hơi cẩn trọng một chút để không bán rẻ đất nước và lương tâm mình; nào là dạy cho các địa chủ biết ơn động lòng thương xót đối với người thuê đất của họ dẫu chỉ một chút.

EN | Therefore I repeat, let no man talk to me of these and the like expedients, till he hath at least some glympse of hope, that there will ever be some hearty and sincere attempt to put them into practice.
VI | Cho nên tôi xin nhắc lại, đừng ai nói với tôi về những giải pháp ấy và những giải pháp tương tự, cho đến khi người đó có được dẫu chỉ một tia hy vọng mong manh rằng sẽ thực sự có một nỗ lực chân thành và quyết tâm để đưa chúng vào thực tiễn.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wodehouse-jeeves
humor · My Man Jeeves (Corky and his uncle Mr. Worple) · https://www.gutenberg.org/ebooks/8164

EN | You see, the catch about portrait-painting—I’ve looked into the thing a bit—is that you can’t start painting portraits till people come along and ask you to, and they won’t come and ask you to until you’ve painted a lot first. This makes it kind of difficult for a chappie.
VI | Anh biết đấy, điểm oái oăm của nghề vẽ chân dung—tôi cũng có tìm hiểu chút ít—là bạn không thể bắt đầu vẽ chân dung cho đến khi có người đến nhờ bạn vẽ, mà họ lại chẳng thèm đến nhờ cho tới khi bạn đã vẽ được kha khá rồi. Điều này làm cho một anh chàng cảm thấy hơi khó xử.

EN | Now, a great many fellows think that having a rich uncle is a pretty soft snap: but, according to Corky, such is not the case. Corky’s uncle was a robust sort of cove, who looked like living for ever. He was fifty-one, and it seemed as if he might go to par. It was not this, however, that distressed poor old Corky, for he was not bigoted and had no objection to the man going on living. What Corky kicked at was the way the above Worple used to harry him.
VI | Nhiều người nghĩ rằng có một ông chú giàu có là một chuyện sướng như tiên, nhưng theo Corky, thực tế lại không phải vậy. Chú của Corky là một lão người tráng kiện, trông cứ như sẽ sống đời. Ông năm mươi mốt tuổi, và có vẻ như còn thọ chán. Tuy nhiên, điều làm khổ thân cậu Corky tội nghiệp không phải là chuyện đó, vì cậu ấy không hề cố chấp và chẳng có ý kiến gì nếu ông cứ tiếp tục sống. Điều mà Corky bực mình chính là cách cái lão Worple kể trên hay hành hạ cậu ấy.

EN | Corky’s uncle, you see, didn’t want him to be an artist. He didn’t think he had any talent in that direction. He was always urging him to chuck Art and go into the jute business and start at the bottom and work his way up. Jute had apparently become a sort of obsession with him. He seemed to attach almost a spiritual importance to it.
VI | Chả là chú của Corky không muốn cậu theo đuổi nghệ thuật. Ông cho rằng cậu chẳng có chút tài cán gì về mảng đó. Ông cứ giục cậu dẹp xừ cái món nghệ thuật đi để nhảy vào kinh doanh đay, bắt đầu từ chân sai vặt rồi tự thân vận động ngoi lên. Có vẻ như cây đay đã trở thành một dạng ám ảnh đối với ông. Ông dường như gán cho nó một ý nghĩa tâm linh nào đó.

EN | Mr. Worple was peculiar in this respect. As a rule, from what I’ve observed, the American captain of industry doesn’t do anything out of business hours. When he has put the cat out and locked up the office for the night, he just relapses into a state of coma from which he emerges only to start being a captain of industry again. But Mr. Worple in his spare time was what is known as an ornithologist. He had written a book called *American Birds*, and was writing another, to be called *More American Birds*.
VI | Ông Worple có điểm kỳ lạ ở chỗ này. Theo những gì tôi quan sát được, quy luật chung là các ông trùm tư bản Mỹ chẳng màng đến chuyện gì ngoài giờ làm việc. Một khi đã thả mèo ra và khóa văn phòng đi ngủ, họ chỉ việc chìm vào trạng thái hôn mê và chỉ tỉnh lại khi đến giờ tiếp tục làm trùm tư bản. Thế nhưng ông Worple trong thời gian rảnh lại là một người mà người ta gọi là nhà điểu học. Ông đã viết một cuốn sách tựa đề *American Birds* (Các loài chim châu Mỹ) và đang viết một cuốn khác có tên là *More American Birds* (Thêm về các loài chim châu Mỹ).

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-beans
humor · Wikipedia:Don't stuff beans up your nose · https://en.wikipedia.org/wiki/Wikipedia:Don%27t_stuff_beans_up_your_nose

EN | As an old story goes:
VI | Chuyện kể rằng:

EN | The little boy's mother was going off to the market. She worried about her son, who was always up to some mischief. She sternly admonished him, "Be good. Don't get into trouble. Don't eat all the chocolate. Don't spill all the milk. Don't throw stones at the cow. Don't fall down the well." The boy had done all of these things on previous market days. Hoping to head off new trouble, she added, "And don't stuff beans up your nose!" This was a new idea for the boy, who promptly tried it out.
VI | Mẹ của cậu bé nọ chuẩn bị đi chợ. Bà lo lắng cho cậu con trai lúc nào cũng nghịch ngợm của mình. Bà nghiêm khắc dặn dò: "Con ở nhà cho ngoan. Đừng có gây chuyện rắc rối đấy. Đừng có ăn hết chỗ sô-cô-la. Đừng có làm đổ hết sữa. Đừng có ném đá vào con bò. Đừng có ngã xuống giếng." Cậu bé đã làm tất cả những điều này trong những lần mẹ đi chợ trước đây. Hy vọng có thể ngăn chặn những rắc rối mới, bà nói thêm: "Và đừng có nhét đậu vào mũi đấy!" Đây là một ý nghĩ hoàn איn toàn mới đối với cậu bé, và cậu liền thử ngay lập tức.

EN | In our zeal to head off others' unwise actions, we may put forth ideas they have not entertained before. As the popular saying goes, "don't give 'em any ideas".
VI | Vì quá nhiệt tình muốn ngăn cản những hành động dại dột của người khác, chúng ta có thể lại gợi ra những ý tưởng mà họ chưa từng nghĩ tới trước đó. Giống như câu nói cửa miệng: "đừng vẽ đường cho hươu chạy".

EN | For example, if you are warning a vandal for one type of disruptive behavior, don't be tempted to go further and warn them in advance against something else that you think they might try next. It may not have occurred to them until you told them about it.
VI | Chẳng hạn, nếu bạn đang cảnh cáo một kẻ phá hoại về một hành vi quậy phá nào đó, đừng vì thế mà đi xa hơn và cảnh báo trước họ về một điều gì đó khác mà bạn nghĩ có thể họ sẽ thử làm tiếp theo. Họ có thể đã không hề nghĩ đến điều đó nếu như bạn không nói cho họ biết.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 
