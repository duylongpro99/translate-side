# Human scoring sheet: single-pass / translate@1 / qwen3.8-flash

Run `2026-10-07T07-15-22-734Z`, target language `vi`. Fill in a score from 1 to 5 (whole numbers; halves are accepted) after each dimension in every passage section. Leave a line empty to skip it. Lines starting with `EN |` / `VI |` / `CODE |` are the passage; code is kept as is and not scored. Do not edit the `## <id>` headings: the report finds your scores by them.

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
VI | Một chủ đề thường được bàn luận giữa các lập trình viên Go, đặc biệt là những người mới bắt đầu với ngôn ngữ này, là cách xử lý lỗi. Cuộc trò chuyện thường biến thành lời than phiền về số lần xuất hiện của đoạn mã

CODE | if err != nil {
CODE | 	return err
CODE | }

EN | shows up. We recently scanned all the open source projects we could find and discovered that this snippet occurs only once per page or two, less often than some would have you believe. Still, if the perception persists that one must type `if err != nil` all the time, something must be wrong, and the obvious target is Go itself.
VI | xuất hiện. Gần đây, chúng tôi đã quét tất cả các dự án mã nguồn mở mà chúng tôi có thể tìm thấy và phát hiện ra rằng đoạn mã này chỉ xuất hiện khoảng một hoặc hai lần trên mỗi trang, ít hơn nhiều so với những gì một số người muốn bạn tin. Tuy nhiên, nếu vẫn tồn tại quan niệm rằng ta phải gõ `if err != nil` mọi lúc, thì chắc chắn có điều gì đó không ổn, và mục tiêu hiển nhiên chính là bản thân Go.

EN | This is unfortunate, misleading, and easily corrected. Perhaps what is happening is that programmers new to Go ask, "How does one handle errors?", learn this pattern, and stop there. In other languages, one might use a try-catch block or other such mechanism to handle errors. Therefore, the programmer thinks, when I would have used a try-catch in my old language, I will just type `if err != nil` in Go. Over time the Go code collects many such snippets, and the result feels clumsy.
VI | Điều này thật đáng tiếc, gây hiểu lầm và dễ dàng khắc phục. Có lẽ điều đang xảy ra là các lập trình viên mới học Go hỏi: "Làm thế nào để xử lý lỗi?", họ học mẫu hình này và dừng lại ở đó. Trong các ngôn ngữ khác, người ta có thể sử dụng khối try-catch hoặc cơ chế tương tự để xử lý lỗi. Do đó, lập trình viên nghĩ rằng, khi trước đây tôi sẽ dùng try-catch trong ngôn ngữ cũ của mình, thì bây giờ tôi chỉ cần gõ `if err != nil` trong Go. Theo thời gian, mã Go tích lũy nhiều đoạn mã như vậy, và kết quả cảm thấy vụng về.

EN | Regardless of whether this explanation fits, it is clear that these Go programmers miss a fundamental point about errors: *Errors are values.*
VI | Bất kể lời giải thích này có phù hợp hay không, rõ ràng là những lập trình viên Go này bỏ sót một điểm cơ bản về lỗi: *Lỗi là giá trị.*

EN | Values can be programmed, and since errors are values, errors can be programmed.
VI | Giá trị có thể được lập trình hóa, và vì lỗi là giá trị, nên lỗi cũng có thể được lập trình hóa.

EN | Here's a simple example from the `bufio` package's [`Scanner`](https://pkg.go.dev/bufio#Scanner) type. Its `Scan` method performs the underlying I/O, which can of course lead to an error. Yet the `Scan` method does not expose an error at all. Instead, it returns a boolean, and a separate method, to be run at the end of the scan, reports whether an error occurred. Client code looks like this:
VI | Đây là một ví dụ đơn giản từ kiểu [`Scanner`](https://pkg.go.dev/bufio#Scanner) trong gói `bufio`. Phương thức `Scan` thực hiện thao tác I/O bên dưới, điều mà dĩ nhiên có thể dẫn đến lỗi. Tuy nhiên, phương thức `Scan` hoàn toàn không trả về lỗi. Thay vào đó, nó trả về một giá trị boolean, và một phương thức riêng biệt, được gọi khi quá trình quét kết thúc, báo cáo xem liệu có lỗi xảy ra hay không. Mã phía client trông như sau:

CODE | scanner := bufio.NewScanner(input)
CODE | for scanner.Scan() {
CODE | 	token := scanner.Text()
CODE | 	// process token
CODE | }
CODE | if err := scanner.Err(); err != nil {
CODE | 	// process the error
CODE | }

EN | Sure, there is a nil check for an error, but it appears and executes only once. With the real API, the client's code therefore feels more natural: loop until done, then worry about errors. Error handling does not obscure the flow of control.
VI | Chắc chắn, vẫn có một phép kiểm tra nil cho lỗi, nhưng nó chỉ xuất hiện và được thực thi đúng một lần. Với API thực tế, mã của client do đó cảm thấy tự nhiên hơn: lặp cho đến khi xong, rồi lo lắng về các lỗi. Việc xử lý lỗi không làm che mờ luồng điều khiển.

fidelity: 4.6
naturalness: 4.3
tone: 4.2
terminology: 4.1
notes: Concise and natural overall. Technical meaning is preserved without as much parenthetical explanation; a few Go phrases remain slightly translated.---

## go-share-memory
tech-blog · Share Memory By Communicating · https://go.dev/blog/codelab-share

EN | Traditional threading models (commonly used when writing Java, C++, and Python programs, for example) require the programmer to communicate between threads using shared memory. Typically, shared data structures are protected by locks, and threads will contend over those locks to access the data. In some cases, this is made easier by the use of thread-safe data structures such as Python's Queue.
VI | Các mô hình lập trình đa luồng truyền thống (thường được sử dụng khi viết các chương trình Java, C++ và Python, chẳng hạn) đòi hỏi lập trình viên phải giao tiếp giữa các luồng thông qua bộ nhớ chia sẻ. Thông thường, các cấu trúc dữ liệu chia sẻ được bảo vệ bằng khóa (lock), và các luồng sẽ tranh chấp những khóa đó để truy cập dữ liệu. Trong một số trường hợp, việc này trở nên dễ dàng hơn nhờ sử dụng các cấu trúc dữ liệu an toàn cho luồng (thread-safe), chẳng hạn như Queue của Python.

EN | Go's concurrency primitives - goroutines and channels - provide an elegant and distinct means of structuring concurrent software. Instead of explicitly using locks to mediate access to shared data, Go encourages the use of channels to pass references to data between goroutines. This approach ensures that only one goroutine has access to the data at a given time. The concept is summarized in the document [link]Effective Go[/link] (a must-read for any Go programmer):
VI | Các nguyên thủy đồng thời (concurrency primitives) của Go – goroutine và channel – cung cấp một phương tiện thanh lịch và khác biệt để cấu trúc phần mềm đồng thời. Thay vì sử dụng tường minh các khóa để điều phối quyền truy cập vào dữ liệu chia sẻ, Go khuyến khích việc sử dụng channel để truyền tham chiếu dữ liệu giữa các goroutine. Cách tiếp cận này đảm bảo rằng chỉ có một goroutine có quyền truy cập vào dữ liệu tại một thời điểm nhất định. Khái niệm này được tóm tắt trong tài liệu [link]Effective Go[/link] (một tài liệu bắt buộc đọc đối với bất kỳ lập trình viên Go nào):

EN | Do not communicate by sharing memory; instead, share memory by communicating.
VI | Đừng giao tiếp bằng cách chia sẻ bộ nhớ; thay vào đó, hãy chia sẻ bộ nhớ bằng cách giao tiếp.

EN | Consider a program that polls a list of URLs. In a traditional threading environment, one might structure its data like so:
VI | Hãy xem xét một chương trình thăm dò (poll) một danh sách URL. Trong môi trường lập trình đa luồng truyền thống, người ta có thể cấu trúc dữ liệu của nó như sau:

CODE | type Resource struct {
CODE |     url        string
CODE |     polling    bool
CODE |     lastError  error
CODE | }

fidelity: 4.5
naturalness: 4.0
tone: 4.3
terminology: 3.8
notes: Meaning is preserved, but “nguyên ngữ đồng thời” is an awkward rendering of concurrency primitives; several technical terms are generally preserves English technical terms.---

## rust-async-await-primer
tech-blog · Async-await on stable Rust! · https://blog.rust-lang.org/2019/11/07/Async-await-stable/

EN | Async-await: a quick primer
VI | Async-await: giới thiệu nhanh

EN | So, what is async await? Async-await is a way to write functions that can "pause", return control to the runtime, and then pick up from where they left off. Typically those pauses are to wait for I/O, but there can be any number of uses.
VI | Vậy, async await là gì? Async-await là cách viết các hàm có thể "tạm dừng", trả lại quyền điều khiển cho runtime, rồi tiếp tục từ chỗ chúng đã dừng. Thông thường, những lần tạm dừng này là để chờ I/O, nhưng cũng có nhiều mục đích sử dụng khác.

EN | To use async-await, you start by writing `async fn` instead of `fn`:
VI | Để dùng async-await, bạn bắt đầu bằng cách viết `async fn` thay vì `fn`:

CODE | async fn first_function() -> u32 { .. }

EN | Unlike a regular function, calling an `async fn` doesn't have any immediate effect. Instead, it returns a `Future`. This is a suspended computation that is waiting to be executed. To actually *execute* the future, use the `.await` operator:
VI | Khác với một hàm thông thường, việc gọi một `async fn` không gây ra tác động tức thì nào. Thay vào đó, nó trả về một `Future`. Đây là một phép tính bị treo, đang chờ được thực thi. Để thực sự *thực thi* future đó, hãy dùng toán tử `.await`:

CODE | async fn another_function() {
CODE |     // Create the future:
CODE |     let future = first_function();
CODE | 
CODE |     // Await the future, which will execute it (and suspend
CODE |     // this function if we encounter a need to wait for I/O):
CODE |     let result: u32 = future.await;
CODE | }

EN | This example shows the first difference between Rust and other languages: we write `future.await` instead of `await future`. This syntax integrates better with Rust's `?` operator for propagating errors (which, after all, are very common in I/O). You can simply write `future.await?` to await the result of a future and propagate errors. It also has the advantage of making method chaining painless.
VI | Ví dụ này cho thấy điểm khác biệt đầu tiên giữa Rust và các ngôn ngữ khác: chúng ta viết `future.await` thay vì `await future`. Cú pháp này tích hợp tốt hơn với toán tử `?` của Rust để lan truyền lỗi (mà suy cho cùng, rất phổ biến trong I/O). Bạn chỉ cần viết `future.await?` để chờ kết quả của một future và lan truyền lỗi. Nó cũng có ưu điểm là giúp việc nối chuỗi phương thức trở nên dễ dàng.

EN | Zero-cost futures
VI | Futures zero-cost

EN | The other difference between Rust futures and futures in JS and C# is that they are based on a "poll" model, which makes them *zero cost*. In other languages, invoking an async function immediately creates a future and schedules it for execution: awaiting the future isn't necessary for it to execute. But this implies some overhead for each future that is created.
VI | Điểm khác biệt còn lại giữa futures trong Rust và futures trong JS hay C# là chúng dựa trên mô hình "poll", khiến chúng trở thành *zero cost*. Ở các ngôn ngữ khác, khi gọi một hàm async, hệ thống sẽ ngay lập tức tạo ra một future và lên lịch cho nó chạy: việc await future không cần thiết để nó được thực thi. Nhưng điều này đồng nghĩa với một số chi phí phát sinh cho mỗi future được tạo ra.

EN | In contrast, in Rust, calling an async function does not do any scheduling in and of itself, which means that we can compose a complex nest of futures without incurring a per-future cost. As an end-user, though, the main thing you'll notice is that *futures feel "lazy"*: they don't do anything until you await them.
VI | Ngược lại, trong Rust, việc gọi một hàm async tự thân nó không hề lên lịch bất kỳ thứ gì, nghĩa là chúng ta có thể ghép nối một cấu trúc future phức tạp mà không phải chịu chi phí cho từng future. Tuy nhiên, với tư cách người dùng cuối, điều bạn sẽ nhận thấy rõ nhất là *futures hoạt động theo kiểu "lazy"*: chúng không làm gì cả cho đến khi bạn await chúng.

fidelity: 4.6
naturalness: 4.3
tone: 4.3
terminology: 4.2
notes: Very readable for a developer audience. Some choices such as “Sở hữu” in related Rust terminology show why a terminology policy is still useful.---

## rust-async-ecosystem
tech-blog · Async-await on stable Rust! (ecosystem) · https://blog.rust-lang.org/2019/11/07/Async-await-stable/

EN | *On this coming Thursday, November 7, async-await syntax hits stable Rust, as part of the 1.39.0 release.* This work has been a long time in development -- the key ideas for zero-cost futures, for example, were [link]first proposed by Aaron Turon and Alex Crichton in 2016[/link]! -- and we are very proud of the end result. We believe that Async I/O is going to be an increasingly important part of Rust's story.
VI | *Vào thứ Năm tới, ngày 7 tháng 11, cú pháp async-await sẽ chính thức ổn định trong Rust, nằm trong bản phát hành 1.39.0.* Công việc này đã được phát triển từ rất lâu -- ví dụ, các ý tưởng then chốt cho futures zero-cost đã được [link]Aaron Turon và Alex Crichton đề xuất lần đầu vào năm 2016[/link]! -- và chúng tôi rất tự hào về kết quả cuối cùng. Chúng tôi tin rằng Async I/O sẽ ngày càng đóng vai trò quan trọng trong câu chuyện của Rust.

EN | While this first release of "async-await" is a momentous event, it's also only the beginning. The current support for async-await marks a kind of "Minimum Viable Product" (MVP). We expect to be polishing, improving, and extending it for some time.
VI | Mặc dù bản phát hành đầu tiên của "async-await" là một sự kiện trọng đại, nhưng đó cũng mới chỉ là bước khởi đầu. Hỗ trợ hiện tại cho async-await đánh dấu một dạng "Sản phẩm khả dụng tối thiểu" (MVP). Chúng tôi dự kiến sẽ tiếp tục hoàn thiện, cải tiến và mở rộng nó trong một thời gian nữa.

EN | Now that async-await is approaching stabilization, all the major Async I/O runtimes are at work adding and extending their support for the new syntax:
VI | Khi async-await đang tiến gần đến giai đoạn ổn định hóa, tất cả các runtime Async I/O lớn đều đang nỗ lực bổ sung và mở rộng hỗ trợ cho cú pháp mới:

EN | the [link]tokio[/link] runtime [link]recently announced a number of scheduler improvements[/link], and they are planning a stable release in November that supports async-await syntax;
VI | runtime [link]tokio[/link] [link]gần đây đã công bố một số cải tiến về scheduler[/link], và họ đang lên kế hoạch cho một bản phát hành ổn định vào tháng 11 với hỗ trợ cú pháp async-await;

EN | the [link]async-std[/link] runtime [link]has been putting out weekly releases for the past few months[/link], and plans to make their 1.0 release shortly after async-await hits stable;
VI | runtime [link]async-std[/link] [link]đã liên tục ra mắt các phiên bản hàng tuần trong vài tháng qua[/link], và dự kiến sẽ tung ra bản phát hành 1.0 ngay sau khi async-await đạt trạng thái ổn định;

EN | using [link]wasm-bindgen-futures[/link], you can even bridge Rust Futures with [link]JavaScript promises[/link];
VI | sử dụng [link]wasm-bindgen-futures[/link], bạn thậm chí có thể cầu nối giữa Rust Futures và [link]JavaScript promises[/link];

EN | the [link]hyper library[/link] has [link]migrated[/link] to adopt standard Rust futures.
VI | thư viện [link]hyper[/link] đã [link]chuyển đổi[/link] để áp dụng chuẩn futures của Rust.

fidelity: 4.5
naturalness: 4.2
tone: 4.3999999999999995
terminology: 4.0
notes: Names and links are preserved, but phrases such as “ổn định hóa”, “cầu nối giữa” and translated MVP terminology reduce naturalness.---

## so-branch-prediction
tech-blog · Why is processing a sorted array faster than processing an unsorted array? · https://stackoverflow.com/a/11227902

EN | You are a victim of branch prediction fail.
VI | Bạn là nạn nhân của lỗi dự đoán phân nhánh.

EN | What is Branch Prediction?
VI | Dự đoán phân nhánh là gì?

EN | Consider a railroad junction. Now for the sake of argument, suppose this is back in the 1800s - before long-distance or radio communication.
VI | Hãy tưởng tượng một ngã ba đường sắt. Để tiện cho việc lập luận, giả sử đây là bối cảnh những năm 1800 - trước khi có liên lạc tầm xa hoặc vô tuyến.

EN | You are a blind operator of a junction and you hear a train coming. You have no idea which way it is supposed to go. You stop the train to ask the driver which direction they want. And then you set the switch appropriately.
VI | Bạn là một người điều khiển mù tại ngã ba và nghe thấy một đoàn tàu đang đến. Bạn không hề biết nó định đi hướng nào. Bạn dừng tàu lại để hỏi tài xế muốn rẽ theo hướng nào. Sau đó, bạn mới chuyển ghi cho phù hợp.

EN | Trains are heavy and have a lot of inertia, so they take forever to start up and slow down.
VI | Tàu hỏa rất nặng và có quán tính lớn, nên chúng mất rất nhiều thời gian để khởi động và giảm tốc.

EN | Is there a better way? You guess which direction the train will go! If you guessed right, it continues on. If you guessed wrong, the driver will stop, back up, and yell at you to flip the switch. Then it can restart down the other path.
VI | Có cách nào tốt hơn không? Bạn hãy đoán xem tàu sẽ đi hướng nào! Nếu đoán đúng, tàu cứ thế chạy tiếp. Nếu đoán sai, tài xế sẽ dừng lại, lùi xe, và quát bạn phải đổi ghi. Sau đó, tàu mới có thể khởi động lại theo hướng kia.

EN | If you guess right every time, the train will never have to stop. If you guess wrong too often, the train will spend a lot of time stopping, backing up, and restarting.
VI | Nếu bạn đoán đúng mọi lần, tàu sẽ không bao giờ phải dừng lại. Nếu bạn đoán sai quá thường xuyên, tàu sẽ dành nhiều thời gian để dừng, lùi và khởi động lại.

EN | Consider an if-statement: At the processor level, it is a branch instruction. You are a processor and you see a branch. You have no idea which way it will go. What do you do? You halt execution and wait until the previous instructions are complete. Then you continue down the correct path.
VI | Xét một câu lệnh if: Ở cấp độ bộ xử lý, đây là một chỉ thị phân nhánh. Bạn là bộ xử lý và bạn gặp một phân nhánh. Bạn không biết nó sẽ đi hướng nào. Bạn làm gì? Bạn tạm dừng thực thi và chờ cho đến khi các chỉ thị trước đó hoàn tất. Sau đó, bạn mới tiếp tục theo hướng chính xác.

EN | This is branch prediction. I admit it's not the best analogy since the train could just signal the direction with a flag. But in computers, the processor doesn't know which direction a branch will go until the last moment.
VI | Đây chính là dự đoán phân nhánh. Tôi thừa nhận đây không phải là phép so sánh hay nhất vì tàu có thể dùng cờ hiệu để báo hướng. Nhưng trong máy tính, bộ xử lý không biết phân nhánh sẽ đi hướng nào cho đến phút chót.

EN | As hinted from above, the culprit is this if-statement:
VI | Như đã gợi ý ở trên, thủ phạm chính là câu lệnh if này:

CODE | if (data[c] >= 128)
CODE |     sum += data[c];

EN | Notice that the data is evenly distributed between 0 and 255. When the data is sorted, roughly the first half of the iterations will not enter the if-statement. After that, they will all enter the if-statement. This is very friendly to the branch predictor since the branch consecutively goes the same direction many times.
VI | Lưu ý rằng dữ liệu được phân bố đều từ 0 đến 255. Khi dữ liệu đã được sắp xếp, khoảng nửa đầu vòng lặp sẽ không đi vào câu lệnh if. Sau đó, tất cả các vòng lặp còn lại đều đi vào câu lệnh if. Điều này rất thuận lợi cho bộ dự đoán phân nhánh vì phân nhánh liên tục đi cùng một hướng qua nhiều lần lặp.

fidelity: 4.5
naturalness: 4.4
tone: 4.3999999999999995
terminology: 4.3
notes: The railroad analogy is conveyed well; some sentences are occasionally literal and “branch prediction” terminology could stay closer to common developer usage.---

## docker-multistage
docs · Multi-stage builds · https://docs.docker.com/build/building/multi-stage/

EN | Multi-stage builds
VI | Build nhiều giai đoạn

EN | Multi-stage builds are useful to anyone who has struggled to optimize Dockerfiles while keeping them easy to read and maintain.
VI | Build nhiều giai đoạn hữu ích cho bất kỳ ai từng phải vật lộn để tối ưu hóa Dockerfile trong khi vẫn giữ chúng dễ đọc và dễ bảo trì.

EN | Use multi-stage builds
VI | Sử dụng build nhiều giai đoạn

EN | With multi-stage builds, you use multiple `FROM` statements in your Dockerfile. Each `FROM` instruction can use a different base, and each of them begins a new stage of the build. You can selectively copy artifacts from one stage to another, leaving behind everything you don't want in the final image.
VI | Với build nhiều giai đoạn, bạn sử dụng nhiều câu lệnh `FROM` trong Dockerfile. Mỗi chỉ thị `FROM` có thể dùng một base khác nhau, và mỗi lần như vậy sẽ bắt đầu một giai đoạn build mới. Bạn có thể chọn lọc sao chép các artifact từ giai đoạn này sang giai đoạn khác, bỏ lại mọi thứ mà bạn không muốn đưa vào image cuối cùng.

EN | The following Dockerfile has two separate stages: one for building a binary, and another where the binary gets copied from the first stage into the next stage.
VI | Dockerfile sau đây có hai giai đoạn riêng biệt: một giai đoạn để build binary, và giai đoạn kia nơi binary được sao chép từ giai đoạn đầu tiên sang giai đoạn tiếp theo.

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
VI | Kết quả cuối cùng là một image production nhỏ gọn, chỉ chứa binary bên trong. Không có công cụ build nào cần thiết để xây dựng ứng dụng được bao gồm trong image kết quả.

EN | How does it work? The second `FROM` instruction starts a new build stage with the `scratch` image as its base. The `COPY --from=0` line copies just the built artifact from the previous stage into this new stage. The Go SDK and any intermediate artifacts are left behind, and not saved in the final image.
VI | Nó hoạt động như thế nào? Câu lệnh `FROM` thứ hai bắt đầu một giai đoạn build mới với image `scratch` làm base. Dòng `COPY --from=0` chỉ sao chép artifact đã build từ giai đoạn trước đó sang giai đoạn mới này. Go SDK và bất kỳ artifact trung gian nào đều bị bỏ lại phía sau và không được lưu vào image cuối cùng.

fidelity: 4.7
naturalness: 4.5
tone: 4.3999999999999995
terminology: 4.3
notes: Technically clear and faithful. “image”, “build”, “artifact” are mostly appropriate, though some prose remains occasionally literal.---

## k8s-pods
docs · Pods · https://kubernetes.io/docs/concepts/workloads/pods/

EN | Pods
VI | Pod

EN | *Pods* are the smallest deployable units of computing that you can create and manage in Kubernetes.
VI | *Pod* là đơn vị triển khai nhỏ nhất trong Kubernetes mà bạn có thể tạo và quản lý.

EN | A *Pod* (as in a pod of whales or pea pod) is a group of one or more containers, with shared storage and network resources, and a specification for how to run the containers. A Pod's contents are always co-located and co-scheduled, and run in a shared context. A Pod models an application-specific "logical host": it contains one or more application containers which are relatively tightly coupled. In non-cloud contexts, applications executed on the same physical or virtual machine are analogous to cloud applications executed on the same logical host.
VI | Một *Pod* (giống như một đàn cá voi hoặc một quả đậu) là một nhóm gồm một hoặc nhiều container, dùng chung tài nguyên lưu trữ và mạng, cùng với đặc tả về cách chạy các container đó. Nội dung của một Pod luôn được đặt cùng chỗ và lên lịch cùng lúc, chạy trong một bối cảnh chia sẻ. Một Pod mô hình hóa một "máy chủ logic" dành riêng cho ứng dụng: nó chứa một hoặc nhiều container ứng dụng có mối liên kết chặt chẽ với nhau. Trong các môi trường không phải đám mây, các ứng dụng chạy trên cùng một máy vật lý hoặc máy ảo tương tự như các ứng dụng đám mây chạy trên cùng một máy chủ logic.

EN | As well as application containers, a Pod can contain init containers that run during Pod startup. You can also inject ephemeral containers for debugging a running Pod.
VI | Ngoài các container ứng dụng, một Pod cũng có thể chứa các init container chạy trong quá trình khởi động Pod. Bạn cũng có thể chèn các ephemeral container để gỡ lỗi một Pod đang chạy.

EN | What is a Pod?
VI | Pod là gì?

EN | The shared context of a Pod is a set of Linux namespaces, cgroups, and potentially other facets of isolation - the same things that isolate a container. Within a Pod's context, the individual applications may have further sub-isolations applied.
VI | Bối cảnh chia sẻ của một Pod là một tập hợp các namespace Linux, cgroup và có thể bao gồm các khía cạnh cô lập khác - giống như những thứ dùng để cô lập một container. Trong bối cảnh của một Pod, các ứng dụng riêng lẻ có thể áp dụng thêm các mức cô lập con.

EN | A Pod is similar to a set of containers with shared namespaces and shared filesystem volumes.
VI | Một Pod tương tự như một nhóm các container dùng chung namespace và volume hệ thống tệp.

EN | Pods in a Kubernetes cluster are used in two main ways:
VI | Các Pod trong một cụm Kubernetes được sử dụng theo hai cách chính:

EN | *Pods that run a single container*. The "one-container-per-Pod" model is the most common Kubernetes use case; in this case, you can think of a Pod as a wrapper around a single container; Kubernetes manages Pods rather than managing the containers directly.
VI | *Pod chạy một container duy nhất*. Mô hình "một container cho mỗi Pod" là trường hợp sử dụng phổ biến nhất trong Kubernetes; trong trường hợp này, bạn có thể coi một Pod như một lớp bọc quanh một container duy nhất; Kubernetes quản lý các Pod thay vì quản lý trực tiếp các container.

EN | *Pods that run multiple containers that need to work together*. A Pod can encapsulate an application composed of [link]multiple co-located containers[/link] that are tightly coupled and need to share resources. These co-located containers form a single cohesive unit.
VI | *Pod chạy nhiều container cần hoạt động cùng nhau*. Một Pod có thể đóng gói một ứng dụng được cấu thành từ [link]nhiều container cùng chỗ[/link], có mối liên kết chặt chẽ và cần chia sẻ tài nguyên. Các container cùng chỗ này tạo thành một đơn vị thống nhất.

fidelity: 4.7
naturalness: 4.5
tone: 4.3999999999999995
terminology: 4.3
notes: Strong technical fidelity; terminology is understandable but some Kubernetes wording is more translated than community-standard.---

## mdn-closures
docs · Closures · https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures

EN | Closures
VI | Closures

EN | A *closure* is the combination of a function bundled together (enclosed) with references to its surrounding state (the *lexical environment*). In other words, a closure gives a function access to its outer scope. In JavaScript, closures are created every time a function is created, at function creation time.
VI | *Closure* là sự kết hợp giữa một hàm được đóng gói cùng với các tham chiếu đến trạng thái xung quanh nó (*lexical environment*). Nói cách khác, closure cho phép một hàm truy cập vào phạm vi bên ngoài của nó. Trong JavaScript, closures được tạo ra mỗi khi một hàm được khai báo, tại thời điểm tạo hàm.

EN | Lexical scoping
VI | Lexical scoping

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
VI | `init()` tạo ra một biến cục bộ tên là `name` và một hàm tên là `displayName()`. Hàm `displayName()` là một hàm nội bộ (inner function), được định nghĩa bên trong `init()` và chỉ khả dụng trong phần thân của hàm `init()`. Lưu ý rằng hàm `displayName()` không có bất kỳ biến cục bộ nào của riêng nó. Tuy nhiên, vì các hàm nội bộ có quyền truy cập vào các biến thuộc phạm vi bên ngoài, nên `displayName()` có thể truy cập biến `name` được khai báo trong hàm cha, tức là `init()`.

EN | If you run this code in your console, you can see that the `console.log()` statement within the `displayName()` function successfully displays the value of the `name` variable, which is declared in its parent function. This is an example of *lexical scoping*, which describes how a parser resolves variable names when functions are nested. The word *lexical* refers to the fact that lexical scoping uses the location where a variable is declared within the source code to determine where that variable is available. Nested functions have access to variables declared in their outer scope.
VI | Nếu bạn chạy đoạn mã này trong console, bạn sẽ thấy câu lệnh `console.log()` bên trong hàm `displayName()` hiển thị thành công giá trị của biến `name`, vốn được khai báo trong hàm cha của nó. Đây là một ví dụ về *lexical scoping*, mô tả cách trình phân tích cú pháp giải quyết tên biến khi các hàm được lồng nhau. Từ *lexical* ám chỉ thực tế là lexical scoping sử dụng vị trí khai báo biến trong mã nguồn để xác định nơi biến đó có sẵn. Các hàm lồng nhau có quyền truy cập vào các biến được khai báo trong phạm vi bên ngoài của chúng.

fidelity: 4.6
naturalness: 4.4
tone: 4.3
terminology: 4.2
notes: Concepts are preserved; several explanatory phrases sound translated rather than native technical Vietnamese.---

## mdn-using-promises
docs · Using promises · https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises

EN | Using promises
VI | Sử dụng Promise

EN | A `Promise` is an object representing the eventual completion or failure of an asynchronous operation. Since most people are consumers of already-created promises, this guide will explain consumption of returned promises before explaining how to create them.
VI | `Promise` là một đối tượng biểu thị cho sự hoàn tất hoặc thất bại cuối cùng của một thao tác bất đồng bộ. Vì hầu hết mọi người đều là người tiêu dùng các promise đã được tạo sẵn, hướng dẫn này sẽ giải thích cách sử dụng các promise được trả về trước khi giải thích cách tạo ra chúng.

EN | Essentially, a promise is a returned object to which you attach callbacks, instead of passing callbacks into a function. Imagine a function, `createAudioFileAsync()`, which asynchronously generates a sound file given a configuration record and two callback functions: one called if the audio file is successfully created, and the other called if an error occurs.
VI | Về cơ bản, một promise là một đối tượng được trả về mà bạn gắn các callback vào đó, thay vì truyền các callback vào một hàm. Hãy tưởng tượng một hàm `createAudioFileAsync()`, hàm này tạo ra một tệp âm thanh một cách bất đồng bộ dựa trên một bản ghi cấu hình và hai hàm callback: một hàm được gọi nếu tệp âm thanh được tạo thành công, và hàm kia được gọi nếu xảy ra lỗi.

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
VI | Nếu `createAudioFileAsync()` được viết lại để trả về một promise, bạn sẽ gắn các callback của mình vào nó thay thế:

CODE | createAudioFileAsync(audioSettings).then(successCallback, failureCallback);

EN | This convention has several advantages. We will explore each one.
VI | Quy ước này có nhiều lợi ích. Chúng ta sẽ khám phá từng lợi ích một.

EN | Chaining
VI | Ghép chuỗi (Chaining)

EN | A common need is to execute two or more asynchronous operations back to back, where each subsequent operation starts when the previous operation succeeds, with the result from the previous step. In the old days, doing several asynchronous operations in a row would lead to the classic [link]callback hell[/link]:
VI | Một nhu cầu phổ biến là thực hiện hai hoặc nhiều thao tác bất đồng bộ liên tiếp, trong đó mỗi thao tác sau bắt đầu khi thao tác trước thành công, với kết quả từ bước trước đó. Trước đây, việc thực hiện nhiều thao tác bất đồng bộ nối tiếp nhau thường dẫn đến tình trạng [link]địa ngục callback[/link] kinh điển:

CODE | doSomething(function (result) {
CODE |   doSomethingElse(result, function (newResult) {
CODE |     doThirdThing(newResult, function (finalResult) {
CODE |       console.log(`Got the final result: ${finalResult}`);
CODE |     }, failureCallback);
CODE |   }, failureCallback);
CODE | }, failureCallback);

fidelity: 4.6
naturalness: 4.4
tone: 4.3
terminology: 4.2
notes: Faithful overall. Technical vocabulary is mostly safe, but some sentences use occasionally literal Vietnamese structure.---

## rust-async-executor
docs · Applied: Build an Executor (Asynchronous Programming in Rust) · https://rust-lang.github.io/async-book/02_execution/04_executor.html

EN | Applied: Build an Executor
VI | Bài tập thực hành: Xây dựng một Executor

EN | Rust's `Future`s are lazy: they won't do anything unless actively driven to completion. One way to drive a future to completion is to `.await` it inside an `async` function, but that just pushes the problem one level up: who will run the futures returned from the top-level `async` functions? The answer is that we need a `Future` executor.
VI | `Future` trong Rust là lười (lazy): chúng sẽ không làm gì cả trừ khi được chủ động đẩy đến khi hoàn thành. Một cách để đưa future đến trạng thái hoàn thành là dùng `.await` bên trong một hàm `async`, nhưng điều đó chỉ đơn giản là đẩy vấn đề lên một cấp độ cao hơn: ai sẽ chạy các future được trả về từ các hàm `async` ở cấp cao nhất? Câu trả lời là chúng ta cần một executor cho `Future`.

EN | `Future` executors take a set of top-level `Future`s and run them to completion by calling `poll` whenever the `Future` can make progress. Typically, an executor will `poll` a future once to start off. When `Future`s indicate that they are ready to make progress by calling `wake()`, they are placed back onto a queue and `poll` is called again, repeating until the `Future` has completed.
VI | Executor của `Future` nhận một tập hợp các `Future` ở cấp cao nhất và chạy chúng đến khi hoàn tất bằng cách gọi `poll` bất cứ khi nào `Future` có thể tiến triển. Thông thường, executor sẽ `poll` một future một lần để khởi động. Khi các `Future` báo hiệu rằng chúng sẵn sàng tiến triển bằng cách gọi `wake()`, chúng được đặt lại vào hàng đợi và `poll` được gọi lại, lặp đi lặp lại cho đến khi `Future` hoàn thành.

EN | In this section, we'll write our own simple executor capable of running a large number of top-level futures to completion concurrently.
VI | Trong phần này, chúng ta sẽ viết một executor đơn giản riêng, có khả năng chạy đồng thời một số lượng lớn các future ở cấp cao nhất cho đến khi hoàn tất.

EN | For this example, we depend on the `futures` crate for the `ArcWake` trait, which provides an easy way to construct a `Waker`. Edit `Cargo.toml` to add a new dependency:
VI | Cho ví dụ này, chúng ta phụ thuộc vào crate `futures` cho trait `ArcWake`, cung cấp một cách dễ dàng để xây dựng một `Waker`. Hãy chỉnh sửa `Cargo.toml` để thêm một dependency mới:

CODE | [package]
CODE | name = "timer_future"
CODE | version = "0.1.0"
CODE | authors = ["XYZ Author"]
CODE | edition = "2021"
CODE | 
CODE | [dependencies]
CODE | futures = "0.3"

EN | Our executor will work by sending tasks to run over a channel. The executor will pull events off of the channel and run them. When a task is ready to do more work (is awoken), it can schedule itself to be polled again by putting itself back onto the channel.
VI | Executor của chúng ta sẽ hoạt động bằng cách gửi các task cần chạy qua một channel. Executor sẽ lấy các sự kiện ra khỏi channel và chạy chúng. Khi một task đã sẵn sàng để làm thêm công việc (được đánh thức), nó có thể tự lập lịch để được poll lại bằng cách đặt chính nó trở lại vào channel.

EN | In this design, the executor itself just needs the receiving end of the task channel. The user will get a sending end so that they can spawn new futures. Tasks themselves are just futures that can reschedule themselves, so we'll store them as a future paired with a sender that the task can use to requeue itself.
VI | Trong thiết kế này, bản thân executor chỉ cần phía nhận của channel task. Người dùng sẽ nhận được phía gửi để họ có thể spawn các future mới. Các task bản chất chỉ là những future có thể tự lập lịch lại, vì vậy chúng ta sẽ lưu trữ chúng dưới dạng một future được ghép đôi với một sender mà task có thể sử dụng để tự xếp hàng lại.

fidelity: 4.5
naturalness: 4.3
tone: 4.3
terminology: 4.0
notes: Good conceptual fidelity, but Rust execution terminology is sometimes translated too occasionally literally and the prose is somewhat stiff.---

## rust-book-ownership
docs · What Is Ownership? · https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html

EN | What Is Ownership?
VI | Sở hữu là gì?

EN | *Ownership* is a set of rules that govern how a Rust program manages memory. All programs have to manage the way they use a computer’s memory while running. Some languages have garbage collection that regularly looks for no-longer-used memory as the program runs; in other languages, the programmer must explicitly allocate and free the memory. Rust uses a third approach: Memory is managed through a system of ownership with a set of rules that the compiler checks. If any of the rules are violated, the program won’t compile. None of the features of ownership will slow down your program while it’s running.
VI | *Sở hữu* là một tập hợp các quy tắc chi phối cách một chương trình Rust quản lý bộ nhớ. Mọi chương trình đều phải quản lý cách chúng sử dụng bộ nhớ của máy tính khi đang chạy. Một số ngôn ngữ có cơ chế thu gom rác (garbage collection) thường xuyên tìm kiếm những vùng bộ nhớ không còn được sử dụng trong quá trình thực thi; ở những ngôn ngữ khác, lập trình viên phải tự mình cấp phát và giải phóng bộ nhớ một cách tường minh. Rust sử dụng phương pháp thứ ba: Bộ nhớ được quản lý thông qua hệ thống sở hữu với một tập hợp các quy tắc mà trình biên dịch sẽ kiểm tra. Nếu bất kỳ quy tắc nào bị vi phạm, chương trình sẽ không thể biên dịch. Không có tính năng nào của hệ thống sở hữu làm chậm chương trình của bạn khi nó đang chạy.

EN | Because ownership is a new concept for many programmers, it does take some time to get used to. The good news is that the more experienced you become with Rust and the rules of the ownership system, the easier you’ll find it to naturally develop code that is safe and efficient. Keep at it!
VI | Vì sở hữu là một khái niệm mới đối với nhiều lập trình viên, nên cần có thời gian để làm quen. Tin tốt là càng có kinh nghiệm với Rust và các quy tắc của hệ thống sở hữu, bạn càng dễ dàng viết ra những đoạn mã an toàn và hiệu quả một cách tự nhiên. Hãy kiên trì nhé!

EN | Both the stack and the heap are parts of memory available to your code to use at runtime, but they are structured in different ways. The stack stores values in the order it gets them and removes the values in the opposite order. This is referred to as *last in, first out (LIFO)*. Think of a stack of plates: When you add more plates, you put them on top of the pile, and when you need a plate, you take one off the top. Adding or removing plates from the middle or bottom wouldn’t work as well!
VI | Cả stack (ngăn xếp) và heap (bộ nhớ động) đều là các phần của bộ nhớ mà code của bạn có thể sử dụng tại thời điểm chạy, nhưng chúng được cấu trúc theo những cách khác nhau. Stack lưu trữ các giá trị theo thứ tự nhận được và loại bỏ chúng theo thứ tự ngược lại. Điều này được gọi là *last in, first out (LIFO)* – vào sau, ra trước. Hãy tưởng tượng một chồng đĩa: Khi thêm đĩa, bạn đặt chúng lên trên cùng của chồng, và khi cần lấy đĩa, bạn lấy từ trên cùng xuống. Việc thêm hoặc bớt đĩa từ giữa hoặc dưới đáy sẽ không thuận tiện bằng!

fidelity: 4.7
naturalness: 4.3
tone: 4.3999999999999995
terminology: 4.0
notes: Core Rust concepts are retained, but “ownership/quyền sở hữu” treatment is more explanatory than a technical reader needs.---

## rust-book-panic
docs · To panic! or Not to panic! · https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html

EN | To `panic!` or Not to `panic!`
VI | `panic!` hay không `panic!`

EN | So, how do you decide when you should call `panic!` and when you should return `Result`? When code panics, there’s no way to recover. You could call `panic!` for any error situation, whether there’s a possible way to recover or not, but then you’re making the decision that a situation is unrecoverable on behalf of the calling code. When you choose to return a `Result` value, you give the calling code options. The calling code could choose to attempt to recover in a way that’s appropriate for its situation, or it could decide that an `Err` value in this case is unrecoverable, so it can call `panic!` and turn your recoverable error into an unrecoverable one. Therefore, returning `Result` is a good default choice when you’re defining a function that might fail.
VI | Vậy, làm thế nào để quyết định khi nào nên gọi `panic!` và khi nào nên trả về `Result`? Khi code panic, sẽ không có cách nào để phục hồi. Bạn có thể gọi `panic!` cho mọi tình huống lỗi, dù có khả năng phục hồi hay không, nhưng như vậy là bạn đang thay mặt cho code gọi hàm đưa ra quyết định rằng tình huống đó là không thể phục hồi. Khi bạn chọn trả về một giá trị `Result`, bạn cung cấp cho code gọi hàm các lựa chọn. Code gọi hàm có thể chọn cố gắng phục hồi theo cách phù hợp với tình huống của nó, hoặc nó có thể quyết định rằng giá trị `Err` trong trường hợp này là không thể phục hồi, vì vậy nó có thể gọi `panic!` và biến lỗi có thể phục hồi của bạn thành lỗi không thể phục hồi. Do đó, trả về `Result` là một lựa chọn mặc định tốt khi bạn định nghĩa một hàm có thể thất bại.

EN | In situations such as examples, prototype code, and tests, it’s more appropriate to write code that panics instead of returning a `Result`.
VI | Trong các tình huống như ví dụ, code nguyên mẫu (prototype) và test, việc viết code gây panic thay vì trả về `Result` thì phù hợp hơn.

EN | Examples, Prototype Code, and Tests
VI | Ví dụ, Code nguyên mẫu và Test

EN | When you’re writing an example to illustrate some concept, also including robust error-handling code can make the example less clear. In examples, it’s understood that a call to a method like `unwrap` that could panic is meant as a placeholder for the way you’d want your application to handle errors, which can differ based on what the rest of your code is doing.
VI | Khi bạn viết một ví dụ để minh họa cho một khái niệm nào đó, việc bao gồm cả code xử lý lỗi chặt chẽ có thể làm cho ví dụ kém rõ ràng hơn. Trong các ví dụ, người ta hiểu rằng một lời gọi đến phương thức như `unwrap` có thể gây panic chỉ là một chỗ trống (placeholder) cho cách mà bạn muốn ứng dụng của mình xử lý lỗi, điều này có thể khác nhau tùy thuộc vào những gì phần còn lại của code đang làm.

EN | Similarly, the `unwrap` and `expect` methods are very handy when you’re prototyping and you’re not yet ready to decide how to handle errors. They leave clear markers in your code for when you’re ready to make your program more robust.
VI | Tương tự, các phương thức `unwrap` và `expect` rất hữu ích khi bạn đang xây dựng nguyên mẫu và chưa sẵn sàng quyết định cách xử lý lỗi. Chúng để lại các dấu vết rõ ràng trong code của bạn cho thời điểm bạn sẵn sàng làm cho chương trình trở nên vững chắc hơn.

EN | If a method call fails in a test, you’d want the whole test to fail, even if that method isn’t the functionality under test. Because `panic!` is how a test is marked as a failure, calling `unwrap` or `expect` is exactly what should happen.
VI | Nếu một lời gọi phương thức thất bại trong một test, bạn sẽ muốn toàn bộ test đó thất bại, ngay cả khi phương thức đó không phải là chức năng đang được kiểm thử. Bởi vì `panic!` là cách đánh dấu một test là thất bại, nên việc gọi `unwrap` hoặc `expect` chính xác là những gì cần xảy ra.

fidelity: 4.6
naturalness: 4.4
tone: 4.3999999999999995
terminology: 4.1
notes: Faithful explanation of panic/error handling; some wording is textbook-like and technical terms could be kept in English.---

## wp-not-a-dictionary
docs · Wikipedia:Wikipedia is not a dictionary · https://en.wikipedia.org/wiki/Wikipedia:Wikipedia_is_not_a_dictionary

EN | Wikipedia is not a dictionary, phrasebook, or a slang, jargon, or usage guide. Instead, the goal of this project is to create an encyclopedia. Our sister project Wiktionary aims to create a dictionary. It is the "lexical companion to Wikipedia", and the two often link to each other. Wiktionary welcomes all editors who wish to write a dictionary.
VI | Wikipedia không phải là từ điển, sách cụm từ, hay hướng dẫn về tiếng lóng, biệt ngữ hoặc cách dùng. Thay vào đó, mục tiêu của dự án này là tạo ra một bộ bách khoa toàn thư. Dự án chị em Wiktionary nhằm xây dựng một từ điển. Đây là "bạn đồng hành từ vựng của Wikipedia", và hai trang thường liên kết với nhau. Wiktionary chào đón mọi người biên tập muốn viết từ điển.

EN | Both dictionary entries at Wiktionary and encyclopedia articles at Wikipedia may start as stubs, but they are works in progress, to be expanded. Wikipedia articles should begin with a good definition, but they should provide other types of information about that topic as well. The full articles that Wikipedia's stubs grow into are very different from dictionary entries.
VI | Cả mục từ điển trên Wiktionary lẫn bài bách khoa toàn thư trên Wikipedia đều có thể bắt đầu dưới dạng bài sơ khai (stub), nhưng chúng là những công trình đang được phát triển để mở rộng thêm. Bài viết trên Wikipedia nên bắt đầu bằng một định nghĩa tốt, nhưng cũng cần cung cấp các loại thông tin khác về chủ đề đó. Các bài viết hoàn chỉnh mà những bài sơ khai của Wikipedia sẽ phát triển thành rất khác so với các mục từ điển.

EN | Each article in an encyclopedia is about a person, people, a concept, a place, an event, a thing, etc., whereas a dictionary entry is primarily about a word, an idiom, or a term and its meaning(s), usage and history.
VI | Mỗi bài trong bách khoa toàn thư nói về một người, nhóm người, một khái niệm, một địa điểm, một sự kiện, một đồ vật, v.v., trong khi một mục từ điển chủ yếu nói về một từ, một thành ngữ hoặc một thuật ngữ cùng ý nghĩa, cách dùng và lịch sử của nó.

fidelity: 4.5
naturalness: 4.4
tone: 4.3999999999999995
terminology: 4.3
notes: Argument is preserved, but Wikipedia-specific wording is occasionally translated too occasionally literally.---

## go-gofmt
opinion · go fmt your code · https://go.dev/blog/gofmt

EN | Introduction
VI | Giới thiệu

EN | Gofmt is a tool that automatically formats Go source code.
VI | Gofmt là công cụ tự động định dạng mã nguồn Go.

EN | Gofmt'd code is:
VI | Mã nguồn được định dạng bằng Gofmt sẽ:

EN | easier to *write*: never worry about minor formatting concerns while hacking away,
VI | dễ *viết* hơn: không cần bận tâm đến các chi tiết định dạng nhỏ khi đang code,

EN | easier to *read*: when all code looks the same you need not mentally convert others' formatting style into something you can understand.
VI | dễ *đọc* hơn: khi mọi đoạn mã đều có cùng một kiểu trình bày, bạn không phải cố gắng chuyển đổi cách định dạng của người khác sang một hình thức mà mình có thể hiểu được.

EN | easier to *maintain*: mechanical changes to the source don't cause unrelated changes to the file's formatting; diffs show only the real changes.
VI | dễ *bảo trì* hơn: những thay đổi mang tính cơ học trong mã nguồn không gây ra các thay đổi không liên quan về định dạng của tệp; diff chỉ hiển thị những thay đổi thực sự.

EN | *uncontroversial*: never have a debate about spacing or brace position ever again!
VI | *không gây tranh cãi*: không bao giờ còn phải bàn bạc về khoảng trắng hay vị trí dấu ngoặc nhọn nữa!

fidelity: 4.6
naturalness: 4.5
tone: 4.5
terminology: 4.3
notes: Clear and faithful; Go terminology is mostly appropriate, though a few phrases read like direct translation.---

## go2-here-we-come
opinion · Go 2, here we come! · https://go.dev/blog/go2-here-we-come

EN | Background
VI | Bối cảnh

EN | At GopherCon 2017, Russ Cox officially started the thought process on the next big version of Go with his talk [link]The Future of Go[/link]. We have called this future language informally Go 2, even though we understand now that it will arrive in incremental steps rather than with a big bang and a single major release. Still, Go 2 is a useful moniker, if only to have a way to talk about that future language, so let’s keep using it for now.
VI | Tại GopherCon 2017, Russ Cox đã chính thức khởi động quá trình suy nghĩ về phiên bản lớn tiếp theo của Go với bài nói chuyện [link]The Future of Go[/link]. Chúng tôi gọi ngôn ngữ tương lai này một cách không chính thức là Go 2, mặc dù giờ đây chúng tôi hiểu rằng nó sẽ đến qua các bước tăng dần thay vì một sự ra mắt đột ngột và một bản phát hành chính duy nhất. Tuy nhiên, Go 2 vẫn là một tên gọi hữu ích, ít nhất là để có một cách nói về ngôn ngữ tương lai đó, nên hãy cứ tiếp tục sử dụng nó cho bây giờ.

EN | A major difference between Go 1 and Go 2 is who is going to influence the design and how decisions are made. Go 1 was a small team effort with modest outside influence; Go 2 will be much more community-driven. After almost 10 years of exposure, we have learned a lot about the language and libraries that we didn’t know in the beginning, and that was only possible through feedback from the Go community.
VI | Một điểm khác biệt lớn giữa Go 1 và Go 2 là ai sẽ ảnh hưởng đến thiết kế và cách đưa ra quyết định. Go 1 là nỗ lực của một nhóm nhỏ với sự tác động bên ngoài khiêm tốn; Go 2 sẽ được thúc đẩy mạnh mẽ bởi cộng đồng hơn. Sau gần 10 năm trải nghiệm, chúng tôi đã học hỏi được rất nhiều điều về ngôn ngữ và các thư viện mà ban đầu chúng tôi chưa biết, và điều đó chỉ có thể thực hiện được nhờ phản hồi từ cộng đồng Go.

EN | In 2015 we introduced the proposal process to gather a specific kind of feedback: proposals for language and library changes. A committee composed of senior Go team members has been reviewing, categorizing, and deciding on incoming proposals on a regular basis. That has worked pretty well, but as part of that process we have ignored all proposals that are not backward-compatible, simply labeling them Go 2 instead.
VI | Năm 2015, chúng tôi giới thiệu quy trình đề xuất (proposal process) để thu thập một loại phản hồi cụ thể: các đề xuất thay đổi ngôn ngữ và thư viện. Một ủy ban gồm các thành viên cấp cao của nhóm Go đã thường xuyên xem xét, phân loại và quyết định các đề xuất gửi đến. Cách làm này hoạt động khá tốt, nhưng trong khuôn khổ quy trình đó, chúng tôi đã bỏ qua tất cả các đề xuất không tương thích ngược, đơn giản chỉ dán nhãn chúng là Go 2.

fidelity: 4.6
naturalness: 4.5
tone: 4.5
terminology: 4.4
notes: Meaning and opinionated tone are preserved; some phrases such as “tên gọi hữu ích” and “đến qua các bước tăng dần” are stiff.---

## wp-dont-bite-newcomers
opinion · Wikipedia:Please do not bite the newcomers · https://en.wikipedia.org/wiki/Wikipedia:Please_do_not_bite_the_newcomers

EN | Wikipedia is improved through the work of both regular editors and newcomers. All of us were new editors once, and in some areas, the most experienced are still regarded as newcomers. Treat newcomers with kindness and patience—nothing scares valuable contributors away faster than hostility.
VI | Wikipedia được cải thiện nhờ công sức của cả những biên tập viên kỳ cựu lẫn người mới. Tất cả chúng ta đều từng là người mới, và ở một số lĩnh vực, ngay cả những người giàu kinh nghiệm nhất vẫn được coi là người mới. Hãy đối xử với người mới bằng sự tử tế và kiên nhẫn—không gì khiến những đóng góp giá trị rời đi nhanh hơn sự thù địch.

EN | The first edits of many currently experienced editors were test edits, unsourced and/or unencyclopedic additions. As a result, it is unlikely for a new editor to be familiar with Wikipedia's markup language and its policies, guidelines, and community standards. Not having a clue is a normal stage in the editor life cycle. We want editors to survive the process.
VI | Những sửa đổi đầu tiên của nhiều biên tập viên hiện đang có kinh nghiệm thường là các thử nghiệm, thêm nội dung không có nguồn tham khảo và/hoặc không phù hợp với tính chất bách khoa thư. Do đó, khó có thể mong đợi một biên tập viên mới quen thuộc với ngôn ngữ đánh dấu (markup) của Wikipedia cũng như các chính sách, hướng dẫn và tiêu chuẩn cộng đồng của nó. Việc chưa biết gì là một giai đoạn bình thường trong vòng đời của một biên tập viên. Chúng ta muốn các biên tập viên trụ lại được qua quá trình này.

EN | Initial interactions set the expectation for the entire community. A welcoming atmosphere invites new editors to mature, while a harsh one fosters an idea that Wikipedia is unkind and rigid.
VI | Những tương tác ban đầu định hình kỳ vọng cho toàn bộ cộng đồng. Một bầu không khí chào đón khuyến khích người mới trưởng thành, trong khi một thái độ gay gắt sẽ nuôi dưỡng ý niệm rằng Wikipedia thiếu thân thiện và cứng nhắc.

EN | Next time you feel frustrated with a newcomer's mistake, take it as an opportunity to nurture potential contributors. Consider improving upon a newcomer's edit rather than reverting it. Wikipedia needs a constant stream of new information, experience, and ideas. Guide newcomers patiently and thoroughly: kindness and patience is a necessity for Wikipedia's survival.
VI | Lần tới khi bạn cảm thấy bực bội trước lỗi lầm của một người mới, hãy xem đó là cơ hội để ươm mầm cho những đóng góp tiềm năng. Cân nhắc việc chỉnh sửa và hoàn thiện thay vì chỉ đơn thuần hoàn tác (revert) sửa đổi của người mới. Wikipedia cần một dòng chảy liên tục của thông tin, kinh nghiệm và ý tưởng mới. Hãy hướng dẫn người mới một cách kiên nhẫn và kỹ lưỡng: sự tử tế và kiên nhẫn là điều thiết yếu cho sự tồn tại của Wikipedia.

fidelity: 4.6
naturalness: 4.5
tone: 4.6
terminology: 4.5
notes: Welcoming tone comes through well; some Wikipedia/community terminology is overly occasionally literal.---

## wp-template-regulars
opinion · Wikipedia:Don't template the regulars · https://en.wikipedia.org/wiki/Wikipedia:Don%27t_template_the_regulars

EN | Wikipedia offers many user talk templates to warn users about possible violations of vandalism, the three-revert rule, and other policies and guidelines. You should use these templates carefully.
VI | Wikipedia cung cấp nhiều mẫu tin nhắn trên trang thảo luận người dùng để cảnh báo về các hành vi có thể vi phạm quy định về phá hoại, quy tắc hoàn tác ba lần và các chính sách, hướng dẫn khác. Bạn nên sử dụng những mẫu này một cách thận trọng.

EN | These templates explain the various policies to new editors. When novice editors breach policies, it is quite possible (if we assume good faith, which we must) that they are unaware of them, and educating them is helpful. On the other hand, most editors who have been around for a while are aware of these policies. If you believe that they have broken (or are about to breach) one, it may be the result of some disagreement over the interpretation of the policy, or temporarily heated tempers. In such situations, the "did you know we had a policy here" approach can be counterproductive in resolving the issue, as it can be construed as being patronising and uncivil.
VI | Các mẫu này giải thích cho biên tập viên mới về những chính sách khác nhau. Khi biên tập viên chưa có kinh nghiệm vi phạm chính sách, rất có thể (nếu chúng ta giả định thiện chí, điều mà chúng ta bắt buộc phải làm) là họ không biết đến các quy định đó, và việc giáo dục cho họ sẽ hữu ích. Mặt khác, hầu hết các biên tập viên đã hoạt động lâu năm đều nắm rõ những chính sách này. Nếu bạn cho rằng họ đã vi phạm (hoặc sắp sửa vi phạm) một chính sách nào đó, thì nguyên nhân có thể là do bất đồng về cách diễn giải chính sách, hoặc do nóng nảy nhất thời. Trong những tình huống như vậy, cách tiếp cận kiểu "bạn có biết ở đây có một chính sách không" có thể phản tác dụng trong việc giải quyết vấn đề, vì nó dễ bị hiểu là trịch thượng và thiếu văn minh.

EN | The problem with templated messages
VI | Vấn đề với các tin nhắn dạng mẫu

EN | Template warnings are very generic, and sometimes out of date. Sometimes a template says never to do something which is nevertheless allowed in certain circumstances. Theoretically speaking, all things are allowed in some conceivable circumstance under Ignore All Rules. Sometimes Wikipedia has multiple policies which are contradictory. If a policy violation is not clear-cut, an amicable resolution to the problem is going to require a human explanation, not an automated template.
VI | Các cảnh báo dạng mẫu thường rất chung chung và đôi khi lỗi thời. Đôi khi một mẫu cấm thực hiện một hành động nào đó, nhưng hành động ấy lại được phép trong một số trường hợp cụ thể. Về mặt lý thuyết, mọi thứ đều được cho phép trong một số tình huống tưởng tượng nào đó theo nguyên tắc Ignore All Rules. Đôi khi Wikipedia có nhiều chính sách mâu thuẫn với nhau. Nếu một vi phạm chính sách không rõ ràng, thì việc giải quyết ổn thỏa vấn đề đòi hỏi phải có lời giải thích từ con người, chứ không phải một mẫu tự động.

fidelity: 4.5
naturalness: 4.4
tone: 4.5
terminology: 4.3
notes: Policy content is faithful, but some long sentences and terms are translationese-heavy.---

## bierce-devils-dictionary
humor · The Devil's Dictionary (selected entries) · https://www.gutenberg.org/ebooks/972

EN | BORE, n. A person who talks when you wish him to listen.
VI | BORE, danh từ. Kẻ cứ nói khi bạn chỉ muốn nghe.

EN | CYNIC, n. A blackguard whose faulty vision sees things as they are, not as they ought to be. Hence the custom among the Scythians of plucking out a cynic's eyes to improve his vision.
VI | CYNIC, danh từ. Một tên vô lại với tầm nhìn lệch lạc, thấy sự vật như chúng vốn là, chứ không phải như chúng nên là. Do đó, người Scythia có tục nhổ mắt kẻ hoài nghi để cải thiện tầm nhìn của hắn.

EN | DIPLOMACY, n. The patriotic art of lying for one's country.
VI | DIPLOMACY, danh từ. Nghệ thuật nói dối yêu nước vì lợi ích của tổ quốc.

EN | HAPPINESS, n. An agreeable sensation arising from contemplating the misery of another.
VI | HAPPINESS, danh từ. Cảm giác dễ chịu nảy sinh khi ngắm nhìn nỗi khổ của người khác.

EN | LAWYER, n. One skilled in circumvention of the law.
VI | LAWYER, danh từ. Người giỏi lách luật.

EN | POLITICS, n. A strife of interests masquerading as a contest of principles. The conduct of public affairs for private advantage.
VI | POLITICS, danh từ. Cuộc xung đột lợi ích đội lốt cuộc đấu tranh về nguyên tắc. Việc quản lý công vụ nhằm tư lợi cá nhân.

EN | POLITICIAN, n. An eel in the fundamental mud upon which the superstructure of organized society is reared. When he wriggles he mistakes the agitation of his tail for the trembling of the edifice.
VI | POLITICIAN, danh từ. Con lươn trong lớp bùn nền tảng mà trên đó tòa nhà siêu cấu trúc của xã hội có tổ chức được dựng lên. Khi nó quẫy, nó nhầm lẫn sự khuấy động của cái đuôi mình với sự rung chuyển của toàn bộ công trình.

fidelity: 4.4
naturalness: 4.2
tone: 4.0
terminology: 4.2
notes: Meaning is mostly preserved, but the deadpan wit is weakened by occasionally literal phrasing and some awkward dictionary terminology.---

## pep20-zen
humor · PEP 20 – The Zen of Python · https://peps.python.org/pep-0020/

EN | The Zen of Python
VI | The Zen of Python

EN | Long time Pythoneer Tim Peters succinctly channels the BDFL's guiding principles for Python's design into 20 aphorisms, only 19 of which have been written down.
VI | Tim Peters, một người dùng Python lâu năm, đã tóm tắt ngắn gọn các nguyên tắc chỉ đạo của BDFL cho thiết kế Python thành 20 câu ngạn ngữ, trong đó chỉ có 19 câu được viết ra.

EN | Beautiful is better than ugly.
VI | Đẹp đẽ tốt hơn xấu xí.

EN | Explicit is better than implicit.
VI | Rõ ràng tốt hơn ngầm định.

EN | Simple is better than complex.
VI | Đơn giản tốt hơn phức tạp.

EN | Complex is better than complicated.
VI | Phức tạp tốt hơn rối rắm.

EN | Flat is better than nested.
VI | Phẳng tốt hơn lồng ghép.

EN | Sparse is better than dense.
VI | Thưa thớt tốt hơn dày đặc.

EN | Readability counts.
VI | Khả năng đọc hiểu là quan trọng.

EN | Special cases aren't special enough to break the rules.
VI | Các trường hợp ngoại lệ không đủ đặc biệt để phá vỡ quy tắc.

EN | Although practicality beats purity.
VI | Mặc dù tính thực dụng thắng sự thuần khiết.

EN | Errors should never pass silently.
VI | Lỗi không bao giờ nên bị bỏ qua âm thầm.

EN | Unless explicitly silenced.
VI | Trừ khi chúng được chủ động im lặng hóa.

EN | In the face of ambiguity, refuse the temptation to guess.
VI | Trước sự mơ hồ, hãy từ chối cám dỗ đoán mò.

EN | There should be one-- and preferably only one --obvious way to do it.
VI | Nên có một -- và tốt nhất là chỉ một -- cách hiển nhiên để làm điều đó.

EN | Although that way may not be obvious at first unless you're Dutch.
VI | Mặc dù cách đó có thể không hiển nhiên ngay lúc đầu trừ khi bạn là người Hà Lan.

EN | Now is better than never.
VI | Bây giờ tốt hơn không bao giờ.

EN | Although never is often better than *right* now.
VI | Mặc dù không bao giờ thường tốt hơn *ngay bây giờ*.

EN | If the implementation is hard to explain, it's a bad idea.
VI | Nếu việc triển khai khó giải thích, thì đó là một ý tưởng tồi.

EN | If the implementation is easy to explain, it may be a good idea.
VI | Nếu việc triển khai dễ giải thích, thì đó có thể là một ý tưởng hay.

EN | Namespaces are one honking great idea -- let's do more of those!
VI | Không gian tên (namespaces) là một ý tưởng tuyệt vời -- hãy tạo thêm nhiều cái như vậy!

fidelity: 4.6
naturalness: 4.2
tone: 4.3
terminology: 4.2
notes: Most aphorisms are accurate, but the title/technical naming and several short aphorisms are translated too occasionally literally; “namespaces” need not be explained.---

## so-regex-html
humor · RegEx match open tags except XHTML self-contained tags · https://stackoverflow.com/a/1732454

EN | You can't parse [X]HTML with regex. Because HTML can't be parsed by regex. Regex is not a tool that can be used to correctly parse HTML. As I have answered in HTML-and-regex questions here so many times before, the use of regex will not allow you to consume HTML. Regular expressions are a tool that is insufficiently sophisticated to understand the constructs employed by HTML. HTML is not a regular language and hence cannot be parsed by regular expressions. Regex queries are not equipped to break down HTML into its meaningful parts. Even enhanced irregular regular expressions as used by Perl are not up to the task of parsing HTML. You will never make me crack. HTML is a language of sufficient complexity that it cannot be parsed by regular expressions. Even Jon Skeet cannot parse HTML using regular expressions. Every time you attempt to parse HTML with regular expressions, the unholy child weeps the blood of virgins, and Russian hackers pwn your webapp. Parsing HTML with regex summons tainted souls into the realm of the living. HTML and regex go together like love, marriage, and ritual infanticide. The `<center>` cannot hold it is too late. The force of regex and HTML together in the same conceptual space will destroy your mind like so much watery putty.
VI | Bạn không thể phân tích cú pháp [X]HTML bằng regex. Vì HTML không thể được phân tích cú pháp bằng regex. Regex không phải là công cụ có thể dùng để phân tích cú pháp HTML một cách chính xác. Như tôi đã trả lời vô số lần trước đây trong các câu hỏi về HTML và regex, việc sử dụng regex sẽ không cho phép bạn xử lý HTML. Biểu thức chính quy là một công cụ thiếu tinh vi để hiểu các cấu trúc mà HTML sử dụng. HTML không phải là một ngôn ngữ chính quy, do đó không thể được phân tích cú pháp bằng biểu thức chính quy. Các truy vấn regex không đủ khả năng để chia nhỏ HTML thành các phần có ý nghĩa. Ngay cả những biểu thức chính quy bất thường nâng cao như được sử dụng bởi Perl cũng không đủ sức để phân tích cú pháp HTML. Bạn sẽ không bao giờ khiến tôi thay đổi quan điểm này. HTML là một ngôn ngữ đủ phức tạp đến mức không thể được phân tích cú pháp bằng biểu thức chính quy. Ngay cả Jon Skeet cũng không thể phân tích cú pháp HTML bằng biểu thức chính quy. Mỗi khi bạn cố gắng phân tích cú pháp HTML bằng biểu thức chính quy, đứa con tà ác khóc ra máu trinh nữ, và các hacker Nga chiếm quyền kiểm soát webapp của bạn. Việc phân tích cú pháp HTML bằng regex triệu hồi những linh hồn ô uế vào cõi sống. HTML và regex đi đôi với nhau như tình yêu, hôn nhân và tập tục giết trẻ sơ sinh. Thẻ `<center>` không thể chứa nổi điều đó, quá muộn rồi. Lực lượng kết hợp của regex và HTML trong cùng một không gian khái niệm sẽ phá hủy tâm trí bạn như một đống bột nhão loãng.

EN | Have you tried using an XML parser instead?
VI | Bạn đã thử dùng một trình phân tích XML chưa?

fidelity: 4.6
naturalness: 4.3
tone: 3.9
terminology: 4.5
notes: Technical content is accurate and regex/HTML terminology is good, but the deliberately absurd humor becomes flatter in Vietnamese.---

## swift-modest-proposal
humor · A Modest Proposal (closing section) · https://www.gutenberg.org/ebooks/1080

EN | I can think of no one objection, that will possibly be raised against this proposal, unless it should be urged, that the number of people will be thereby much lessened in the kingdom. This I freely own, and was indeed one principal design in offering it to the world. I desire the reader will observe, that I calculate my remedy for this one individual Kingdom of Ireland, and for no other that ever was, is, or, I think, ever can be upon Earth. Therefore let no man talk to me of other expedients: Of taxing our absentees at five shillings a pound: Of using neither clothes, nor houshold furniture, except what is of our own growth and manufacture: Of utterly rejecting the materials and instruments that promote foreign luxury: Of curing the expensiveness of pride, vanity, idleness, and gaming in our women: Of introducing a vein of parsimony, prudence and temperance: Of learning to love our country, wherein we differ even from Laplanders, and the inhabitants of Topinamboo: Of being a little cautious not to sell our country and consciences for nothing: Of teaching landlords to have at least one degree of mercy towards their tenants.
VI | Tôi không thể nghĩ ra bất kỳ sự phản đối nào có thể được đưa ra chống lại đề xuất này, trừ khi người ta lập luận rằng số lượng dân cư trong vương quốc sẽ nhờ đó mà giảm đi đáng kể. Điều này tôi hoàn toàn thừa nhận, và thực tế đó chính là một trong những mục đích chủ yếu khi tôi trình bày nó với thế giới. Tôi mong độc giả lưu ý rằng tôi tính toán biện pháp khắc phục của mình chỉ riêng cho Vương quốc Ireland này, chứ không phải cho bất kỳ nơi nào khác từng tồn tại, đang tồn tại, hay, theo tôi nghĩ, có thể tồn tại trên Trái Đất. Do đó, đừng ai nói với tôi về các giải pháp khác: Về việc đánh thuế những kẻ vắng mặt ở mức năm shilling mỗi bảng; Về việc không sử dụng quần áo hay đồ nội thất gia đình, ngoại trừ những thứ do chính chúng ta sản xuất và chế tạo; Về việc từ chối hoàn toàn các nguyên liệu và công cụ thúc đẩy xa hoa ngoại lai; Về việc chữa trị thói phung phí do kiêu hãnh, phù phiếm, lười biếng và cờ bạc của phụ nữ nước ta; Về việc khuyến khích đức tính tiết kiệm, thận trọng và điều độ; Về việc học cách yêu thương đất nước mình, điều mà chúng ta thậm chí còn kém hơn cả người Lapland và cư dân Topinamboo; Về việc cẩn thận một chút để không bán rẻ đất nước và lương tâm mình với giá bèo; Về việc dạy các địa chủ ít nhất phải có một chút lòng thương xót đối với tá điền của họ.

EN | Therefore I repeat, let no man talk to me of these and the like expedients, till he hath at least some glympse of hope, that there will ever be some hearty and sincere attempt to put them into practice.
VI | Vì vậy, tôi nhắc lại, đừng ai nói với tôi về những giải pháp này và những thứ tương tự, cho đến khi người đó ít nhất cũng thấy được một tia hy vọng rằng sẽ luôn có một nỗ lực nhiệt thành và chân thành nhằm áp dụng chúng vào thực tiễn.

fidelity: 4.5
naturalness: 4.2
tone: 4.1
terminology: 4.1
notes: Meaning is largely intact, but the long satirical sentence is heavy in Vietnamese and the satire loses some sharpness.---

## wodehouse-jeeves
humor · My Man Jeeves (Corky and his uncle Mr. Worple) · https://www.gutenberg.org/ebooks/8164

EN | You see, the catch about portrait-painting—I’ve looked into the thing a bit—is that you can’t start painting portraits till people come along and ask you to, and they won’t come and ask you to until you’ve painted a lot first. This makes it kind of difficult for a chappie.
VI | Bạn thấy đấy, cái khó của nghề vẽ chân dung—tôi cũng đã tìm hiểu đôi chút về chuyện này—là bạn không thể bắt đầu vẽ chân dung cho đến khi có người tìm đến đặt hàng, mà họ thì sẽ chẳng thèm tìm đến nếu bạn chưa từng vẽ qua một loạt tác phẩm trước đó. Điều này khiến anh chàng nào cũng cảm thấy nan giải.

EN | Now, a great many fellows think that having a rich uncle is a pretty soft snap: but, according to Corky, such is not the case. Corky’s uncle was a robust sort of cove, who looked like living for ever. He was fifty-one, and it seemed as if he might go to par. It was not this, however, that distressed poor old Corky, for he was not bigoted and had no objection to the man going on living. What Corky kicked at was the way the above Worple used to harry him.
VI | Nhiều người nghĩ rằng có một ông bác giàu có là một điều dễ thở, nhưng theo Corky thì không phải vậy. Bác của Corky là một tay khỏe mạnh, trông như thể sẽ sống mãi với thời gian. Ông ấy năm mươi mốt tuổi, và dường như còn có thể kéo dài thêm lâu nữa. Tuy nhiên, điều làm khổ sở cho lão Corky tội nghiệp không phải là chuyện đó, vì cậu ta không hề cố chấp hay phản đối việc ông bác cứ tiếp tục sống. Cái mà Corky bực mình chính là cách mà vị Worple kể trên luôn quấy rầy cậu ta.

EN | Corky’s uncle, you see, didn’t want him to be an artist. He didn’t think he had any talent in that direction. He was always urging him to chuck Art and go into the jute business and start at the bottom and work his way up. Jute had apparently become a sort of obsession with him. He seemed to attach almost a spiritual importance to it.
VI | Bác của Corky, bạn thấy đấy, không muốn cậu ta trở thành họa sĩ. Ông ấy cho rằng cậu ta chẳng có tài năng gì trong lĩnh vực đó. Ông ấy luôn thúc giục cậu ta bỏ Nghệ thuật đi mà vào ngành kinh doanh sợi đay, bắt đầu từ vị trí thấp nhất rồi dần dần leo lên. Sợi đay rõ ràng đã trở thành một thứ ám ảnh đối với ông ấy. Ông ấy dường như coi nó gần như có tầm quan trọng về mặt tinh thần.

EN | Mr. Worple was peculiar in this respect. As a rule, from what I’ve observed, the American captain of industry doesn’t do anything out of business hours. When he has put the cat out and locked up the office for the night, he just relapses into a state of coma from which he emerges only to start being a captain of industry again. But Mr. Worple in his spare time was what is known as an ornithologist. He had written a book called *American Birds*, and was writing another, to be called *More American Birds*.
VI | Ông Worple khá đặc biệt ở điểm này. Theo những gì tôi quan sát được, thường thì các ông chủ công nghiệp người Mỹ không làm gì ngoài giờ làm việc. Khi đã thả mèo ra ngoài và khóa văn phòng lại để nghỉ đêm, họ chỉ rơi vào trạng thái hôn mê, từ đó tỉnh dậy chỉ để quay lại vai trò ông chủ công nghiệp. Nhưng ông Worple, trong thời gian rảnh rỗi, lại là một người được biết đến như một nhà điểu học. Ông ấy đã viết một cuốn sách tên là *American Birds*, và đang viết một cuốn khác, dự định đặt tên là *More American Birds*.

fidelity: 4.4
naturalness: 4.4
tone: 4.4
terminology: 4.0
notes: The comic voice is more natural than the other versions, especially in the rich-uncle passage. A few period-specific idioms are still flattened or modernized.---

## wp-beans
humor · Wikipedia:Don't stuff beans up your nose · https://en.wikipedia.org/wiki/Wikipedia:Don%27t_stuff_beans_up_your_nose

EN | As an old story goes:
VI | Chuyện xưa kể rằng:

EN | The little boy's mother was going off to the market. She worried about her son, who was always up to some mischief. She sternly admonished him, "Be good. Don't get into trouble. Don't eat all the chocolate. Don't spill all the milk. Don't throw stones at the cow. Don't fall down the well." The boy had done all of these things on previous market days. Hoping to head off new trouble, she added, "And don't stuff beans up your nose!" This was a new idea for the boy, who promptly tried it out.
VI | Mẹ cậu bé sắp đi chợ. Bà lo lắng cho con trai, đứa trẻ lúc nào cũng bày trò nghịch ngợm. Bà nghiêm khắc dặn dò: "Ngoan ngoãn nhé. Đừng gây rắc rối. Đừng ăn hết sô-cô-la. Đừng làm đổ sữa. Đừng ném đá vào con bò. Đừng ngã xuống giếng." Trước đây, mỗi lần mẹ đi chợ, cậu bé đều đã làm tất cả những điều đó. Hy vọng ngăn chặn trước những rắc rối mới, bà nói thêm: "Và đừng nhét đậu vào mũi!" Đây là một ý tưởng hoàn toàn mới đối với cậu bé, và cậu lập tức thử ngay.

EN | In our zeal to head off others' unwise actions, we may put forth ideas they have not entertained before. As the popular saying goes, "don't give 'em any ideas".
VI | Trong sự nhiệt tình muốn ngăn chặn những hành động thiếu khôn ngoan của người khác, chúng ta có thể vô tình đưa ra những ý tưởng mà họ chưa từng nghĩ tới. Như câu nói phổ biến: "đừng gợi ý cho họ".

EN | For example, if you are warning a vandal for one type of disruptive behavior, don't be tempted to go further and warn them in advance against something else that you think they might try next. It may not have occurred to them until you told them about it.
VI | Ví dụ, nếu bạn đang cảnh báo một kẻ phá hoại về một loại hành vi gây rối, đừng bị cám dỗ mà đi xa hơn, cảnh báo trước với họ về một thứ khác mà bạn nghĩ họ có thể sẽ thử tiếp theo. Có thể họ chưa hề nghĩ đến điều đó cho đến khi bạn nhắc tới.

fidelity: 4.6
naturalness: 4.4
tone: 4.4
terminology: 4.1
notes: Natural and concise. “đừng gợi ý cho họ” is understandable but “đừng mách nước cho họ” better captures the idiomatic warning.