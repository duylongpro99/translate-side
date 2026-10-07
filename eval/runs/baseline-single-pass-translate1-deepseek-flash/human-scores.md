# Human scoring sheet: single-pass / translate@1 / ds/deepseek-flash

Run `2026-10-07T02-46-09-276Z`, target language `vi`. Fill in a score from 1 to 5 (whole numbers; halves are accepted) after each dimension in every passage section. Leave a line empty to skip it. Lines starting with `EN |` / `VI |` / `CODE |` are the passage; code is kept as is and not scored. Do not edit the `## <id>` headings: the report finds your scores by them.

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
VI | Một chủ đề thường được các lập trình viên Go, đặc biệt là những người mới học ngôn ngữ này, bàn luận sôi nổi là làm sao để xử lý lỗi. Câu chuyện thường biến thành những lời than vãn về việc đoạn mã

CODE | if err != nil {
CODE | 	return err
CODE | }

EN | shows up. We recently scanned all the open source projects we could find and discovered that this snippet occurs only once per page or two, less often than some would have you believe. Still, if the perception persists that one must type `if err != nil` all the time, something must be wrong, and the obvious target is Go itself.
VI | xuất hiện quá nhiều lần. Gần đây chúng tôi đã quét toàn bộ các dự án mã nguồn mở mà mình tìm được và phát hiện ra rằng đoạn mã này chỉ xuất hiện khoảng một lần mỗi một hai trang, ít hơn nhiều so với những gì người ta vẫn tưởng. Tuy vậy, nếu vẫn tồn tại cảm giác rằng lúc nào cũng phải gõ `if err != nil`, thì hẳn phải có gì đó không ổn, và đối tượng bị đổ lỗi hiển nhiên chính là Go.

EN | This is unfortunate, misleading, and easily corrected. Perhaps what is happening is that programmers new to Go ask, "How does one handle errors?", learn this pattern, and stop there. In other languages, one might use a try-catch block or other such mechanism to handle errors. Therefore, the programmer thinks, when I would have used a try-catch in my old language, I will just type `if err != nil` in Go. Over time the Go code collects many such snippets, and the result feels clumsy.
VI | Điều này thật đáng tiếc, gây hiểu lầm, và có thể dễ dàng sửa chữa. Có lẽ chuyện xảy ra là thế này: những lập trình viên mới làm quen với Go hỏi "Người ta xử lý lỗi như thế nào?", học được cách viết này, rồi dừng lại ở đó. Ở những ngôn ngữ khác, người ta có thể dùng khối try-catch hoặc cơ chế tương tự để xử lý lỗi. Thế là lập trình viên nghĩ rằng, khi lẽ ra mình dùng try-catch trong ngôn ngữ cũ, thì trong Go mình chỉ cần gõ `if err != nil`. Dần dần, mã Go tích tụ đầy những đoạn như vậy, và kết quả trông thật vụng về.

EN | Regardless of whether this explanation fits, it is clear that these Go programmers miss a fundamental point about errors: *Errors are values.*
VI | Dù cách giải thích này có đúng hay không, rõ ràng là những lập trình viên Go này đã bỏ sót một điểm cốt lõi về lỗi: *Lỗi là giá trị.*

EN | Values can be programmed, and since errors are values, errors can be programmed.
VI | Giá trị thì có thể lập trình được, và vì lỗi là giá trị, nên lỗi cũng có thể lập trình được.

EN | Here's a simple example from the `bufio` package's [`Scanner`](https://pkg.go.dev/bufio#Scanner) type. Its `Scan` method performs the underlying I/O, which can of course lead to an error. Yet the `Scan` method does not expose an error at all. Instead, it returns a boolean, and a separate method, to be run at the end of the scan, reports whether an error occurred. Client code looks like this:
VI | Đây là một ví dụ đơn giản từ kiểu [`Scanner`](https://pkg.go.dev/bufio#Scanner) trong gói `bufio`. Phương thức `Scan` của nó thực hiện việc I/O bên dưới, và tất nhiên việc này có thể dẫn đến lỗi. Thế nhưng phương thức `Scan` hoàn toàn không để lộ ra lỗi nào cả. Thay vào đó, nó trả về một giá trị boolean, còn một phương thức riêng, được gọi khi kết thúc quá trình quét, sẽ báo cáo xem có lỗi xảy ra hay không. Mã phía người dùng trông như thế này:

CODE | scanner := bufio.NewScanner(input)
CODE | for scanner.Scan() {
CODE | 	token := scanner.Text()
CODE | 	// process token
CODE | }
CODE | if err := scanner.Err(); err != nil {
CODE | 	// process the error
CODE | }

EN | Sure, there is a nil check for an error, but it appears and executes only once. With the real API, the client's code therefore feels more natural: loop until done, then worry about errors. Error handling does not obscure the flow of control.
VI | Đúng là có một lần kiểm tra nil cho lỗi, nhưng nó chỉ xuất hiện và thực thi một lần duy nhất. Với API thực sự, mã phía người dùng vì thế trở nên tự nhiên hơn: lặp cho đến khi xong, rồi mới bận tâm đến lỗi. Việc xử lý lỗi không còn che khuất luồng điều khiển.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## go-share-memory
tech-blog · Share Memory By Communicating · https://go.dev/blog/codelab-share

EN | Traditional threading models (commonly used when writing Java, C++, and Python programs, for example) require the programmer to communicate between threads using shared memory. Typically, shared data structures are protected by locks, and threads will contend over those locks to access the data. In some cases, this is made easier by the use of thread-safe data structures such as Python's Queue.
VI | Các mô hình luồng truyền thống (thường được dùng khi viết các chương trình Java, C++, và Python chẳng hạn) yêu cầu lập trình viên phải giao tiếp giữa các luồng thông qua bộ nhớ chia sẻ. Thông thường, các cấu trúc dữ liệu chia sẻ được bảo vệ bằng khóa (lock), và các luồng sẽ tranh nhau giành những khóa đó để truy cập dữ liệu. Trong một số trường hợp, điều này trở nên dễ dàng hơn nhờ dùng các cấu trúc dữ liệu an toàn với luồng như Queue của Python.

EN | Go's concurrency primitives - goroutines and channels - provide an elegant and distinct means of structuring concurrent software. Instead of explicitly using locks to mediate access to shared data, Go encourages the use of channels to pass references to data between goroutines. This approach ensures that only one goroutine has access to the data at a given time. The concept is summarized in the document [link]Effective Go[/link] (a must-read for any Go programmer):
VI | Các nguyên thủy đồng thời của Go - goroutine và channel - mang đến một cách thanh lịch và khác biệt để tổ chức phần mềm đồng thời. Thay vì dùng khóa một cách tường minh để điều phối việc truy cập dữ liệu chia sẻ, Go khuyến khích dùng channel để truyền tham chiếu đến dữ liệu giữa các goroutine. Cách tiếp cận này đảm bảo rằng tại một thời điểm chỉ có một goroutine được truy cập dữ liệu. Khái niệm này được tóm gọn trong tài liệu [link]Effective Go[/link] (thứ mà bất kỳ lập trình viên Go nào cũng phải đọc):

EN | Do not communicate by sharing memory; instead, share memory by communicating.
VI | Đừng giao tiếp bằng cách chia sẻ bộ nhớ; thay vào đó, hãy chia sẻ bộ nhớ bằng cách giao tiếp.

EN | Consider a program that polls a list of URLs. In a traditional threading environment, one might structure its data like so:
VI | Hãy xét một chương trình thăm dò (poll) một danh sách các URL. Trong môi trường luồng truyền thống, người ta có thể tổ chức dữ liệu của nó như sau:

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
VI | Vậy async await là gì? Async-await là cách viết các hàm có thể "tạm dừng", trả quyền điều khiển về cho runtime, rồi tiếp tục từ chỗ đã dừng. Thông thường những lần tạm dừng đó là để chờ I/O, nhưng có thể có vô số mục đích sử dụng.

EN | To use async-await, you start by writing `async fn` instead of `fn`:
VI | Để dùng async-await, bạn bắt đầu bằng cách viết `async fn` thay vì `fn`:

CODE | async fn first_function() -> u32 { .. }

EN | Unlike a regular function, calling an `async fn` doesn't have any immediate effect. Instead, it returns a `Future`. This is a suspended computation that is waiting to be executed. To actually *execute* the future, use the `.await` operator:
VI | Khác với hàm thông thường, gọi một `async fn` không có tác dụng gì ngay lập tức. Thay vào đó, nó trả về một `Future`. Đây là một phép tính đang bị treo, chờ được thực thi. Để thực sự *thực thi* future đó, hãy dùng toán tử `.await`:

CODE | async fn another_function() {
CODE |     // Create the future:
CODE |     let future = first_function();
CODE | 
CODE |     // Await the future, which will execute it (and suspend
CODE |     // this function if we encounter a need to wait for I/O):
CODE |     let result: u32 = future.await;
CODE | }

EN | This example shows the first difference between Rust and other languages: we write `future.await` instead of `await future`. This syntax integrates better with Rust's `?` operator for propagating errors (which, after all, are very common in I/O). You can simply write `future.await?` to await the result of a future and propagate errors. It also has the advantage of making method chaining painless.
VI | Ví dụ này cho thấy sự khác biệt đầu tiên giữa Rust và các ngôn ngữ khác: ta viết `future.await` thay vì `await future`. Cú pháp này tích hợp tốt hơn với toán tử `?` của Rust để lan truyền lỗi (mà suy cho cùng, rất phổ biến trong I/O). Bạn chỉ cần viết `future.await?` để chờ kết quả của một future và lan truyền lỗi. Nó cũng có ưu điểm là giúp việc nối chuỗi phương thức trở nên dễ dàng.

EN | Zero-cost futures
VI | Future không tốn chi phí

EN | The other difference between Rust futures and futures in JS and C# is that they are based on a "poll" model, which makes them *zero cost*. In other languages, invoking an async function immediately creates a future and schedules it for execution: awaiting the future isn't necessary for it to execute. But this implies some overhead for each future that is created.
VI | Sự khác biệt khác giữa future trong Rust với future trong JS và C# là chúng dựa trên mô hình "poll", khiến chúng *không tốn chi phí*. Ở các ngôn ngữ khác, gọi một hàm async sẽ tạo ngay một future và lên lịch thực thi nó: không cần await future thì nó vẫn được thực thi. Nhưng điều này kéo theo một số chi phí cho mỗi future được tạo ra.

EN | In contrast, in Rust, calling an async function does not do any scheduling in and of itself, which means that we can compose a complex nest of futures without incurring a per-future cost. As an end-user, though, the main thing you'll notice is that *futures feel "lazy"*: they don't do anything until you await them.
VI | Ngược lại, trong Rust, gọi một hàm async không tự nó thực hiện bất kỳ việc lên lịch nào, nghĩa là ta có thể kết hợp một mạng lưới future phức tạp mà không phải chịu chi phí cho từng future. Tuy nhiên, với người dùng cuối, điều chính bạn sẽ nhận thấy là *future có cảm giác "lười"*: chúng không làm gì cả cho đến khi bạn await chúng.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-async-ecosystem
tech-blog · Async-await on stable Rust! (ecosystem) · https://blog.rust-lang.org/2019/11/07/Async-await-stable/

EN | *On this coming Thursday, November 7, async-await syntax hits stable Rust, as part of the 1.39.0 release.* This work has been a long time in development -- the key ideas for zero-cost futures, for example, were [link]first proposed by Aaron Turon and Alex Crichton in 2016[/link]! -- and we are very proud of the end result. We believe that Async I/O is going to be an increasingly important part of Rust's story.
VI | *Vào thứ Năm tuần này, ngày 7 tháng 11, cú pháp async-await sẽ có mặt trên Rust ổn định, như một phần của bản phát hành 1.39.0.* Công trình này đã được phát triển từ rất lâu rồi -- ví dụ, những ý tưởng then chốt cho zero-cost futures đã được [link]Aaron Turon và Alex Crichton đề xuất lần đầu vào năm 2016[/link]! -- và chúng tôi vô cùng tự hào về kết quả cuối cùng. Chúng tôi tin rằng Async I/O sẽ ngày càng trở thành một phần quan trọng trong câu chuyện của Rust.

EN | While this first release of "async-await" is a momentous event, it's also only the beginning. The current support for async-await marks a kind of "Minimum Viable Product" (MVP). We expect to be polishing, improving, and extending it for some time.
VI | Bản phát hành "async-await" đầu tiên này là một sự kiện trọng đại, nhưng nó cũng chỉ là khởi đầu. Hỗ trợ hiện tại cho async-await đánh dấu một dạng "Sản phẩm khả dụng tối thiểu" (Minimum Viable Product - MVP). Chúng tôi dự kiến sẽ còn mài giũa, cải thiện và mở rộng nó trong một thời gian dài nữa.

EN | Now that async-await is approaching stabilization, all the major Async I/O runtimes are at work adding and extending their support for the new syntax:
VI | Giờ đây khi async-await đang tiến gần đến giai đoạn ổn định, tất cả các runtime Async I/O chủ chốt đều đang bổ sung và mở rộng hỗ trợ cho cú pháp mới:

EN | the [link]tokio[/link] runtime [link]recently announced a number of scheduler improvements[/link], and they are planning a stable release in November that supports async-await syntax;
VI | runtime [link]tokio[/link] [link]mới đây đã công bố một loạt cải tiến về scheduler[/link], và họ đang lên kế hoạch phát hành bản ổn định vào tháng 11 hỗ trợ cú pháp async-await;

EN | the [link]async-std[/link] runtime [link]has been putting out weekly releases for the past few months[/link], and plans to make their 1.0 release shortly after async-await hits stable;
VI | runtime [link]async-std[/link] [link]đã phát hành phiên bản mới hàng tuần trong vài tháng qua[/link], và dự định ra mắt bản 1.0 ngay sau khi async-await có mặt trên bản ổn định;

EN | using [link]wasm-bindgen-futures[/link], you can even bridge Rust Futures with [link]JavaScript promises[/link];
VI | dùng [link]wasm-bindgen-futures[/link], bạn thậm chí có thể kết nối Rust Futures với [link]JavaScript promises[/link];

EN | the [link]hyper library[/link] has [link]migrated[/link] to adopt standard Rust futures.
VI | thư viện [link]hyper[/link] đã [link]chuyển đổi[/link] để áp dụng futures chuẩn của Rust.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## so-branch-prediction
tech-blog · Why is processing a sorted array faster than processing an unsorted array? · https://stackoverflow.com/a/11227902

EN | You are a victim of branch prediction fail.
VI | Bạn là nạn nhân của việc dự đoán nhánh thất bại.

EN | What is Branch Prediction?
VI | Dự đoán nhánh là gì?

EN | Consider a railroad junction. Now for the sake of argument, suppose this is back in the 1800s - before long-distance or radio communication.
VI | Hãy hình dung một giao lộ đường sắt. Giờ để tiện bàn luận, giả sử đây là thời những năm 1800 - trước khi có liên lạc đường dài hay vô tuyến.

EN | You are a blind operator of a junction and you hear a train coming. You have no idea which way it is supposed to go. You stop the train to ask the driver which direction they want. And then you set the switch appropriately.
VI | Bạn là một nhân viên điều khiển giao lộ bị mù và bạn nghe thấy một đoàn tàu đang đến. Bạn không biết nó định đi hướng nào. Bạn dừng tàu lại để hỏi tài xế muốn đi hướng nào. Rồi bạn gạt cần chuyển hướng cho phù hợp.

EN | Trains are heavy and have a lot of inertia, so they take forever to start up and slow down.
VI | Tàu thì nặng và có quán tính lớn, nên chúng mất cả đời để khởi động và giảm tốc.

EN | Is there a better way? You guess which direction the train will go! If you guessed right, it continues on. If you guessed wrong, the driver will stop, back up, and yell at you to flip the switch. Then it can restart down the other path.
VI | Có cách nào tốt hơn không? Bạn đoán xem tàu sẽ đi hướng nào! Nếu đoán đúng, tàu cứ thế chạy tiếp. Nếu đoán sai, tài xế sẽ dừng lại, lùi lại, và mắng bạn té tát vì tội không gạt cần. Rồi tàu mới có thể khởi động lại theo hướng kia.

EN | If you guess right every time, the train will never have to stop. If you guess wrong too often, the train will spend a lot of time stopping, backing up, and restarting.
VI | Nếu lần nào bạn cũng đoán đúng, tàu sẽ không bao giờ phải dừng. Nếu bạn đoán sai quá thường xuyên, tàu sẽ tốn rất nhiều thời gian để dừng, lùi lại, và khởi động lại.

EN | Consider an if-statement: At the processor level, it is a branch instruction. You are a processor and you see a branch. You have no idea which way it will go. What do you do? You halt execution and wait until the previous instructions are complete. Then you continue down the correct path.
VI | Hãy xét một câu lệnh if: Ở cấp độ bộ xử lý, nó là một lệnh rẽ nhánh. Bạn là bộ xử lý và bạn thấy một nhánh. Bạn không biết nó sẽ đi hướng nào. Bạn làm gì? Bạn tạm dừng thực thi và đợi cho đến khi các lệnh trước đó hoàn tất. Rồi bạn đi tiếp theo đúng hướng.

EN | This is branch prediction. I admit it's not the best analogy since the train could just signal the direction with a flag. But in computers, the processor doesn't know which direction a branch will go until the last moment.
VI | Đây chính là dự đoán nhánh. Tôi thừa nhận đây không phải là phép so sánh hay nhất, vì tàu hoàn toàn có thể chỉ cần ra hiệu hướng đi bằng một lá cờ. Nhưng trong máy tính, bộ xử lý không biết một nhánh sẽ đi hướng nào cho đến phút cuối cùng.

EN | As hinted from above, the culprit is this if-statement:
VI | Như đã gợi ý ở trên, thủ phạm chính là câu lệnh if này:

CODE | if (data[c] >= 128)
CODE |     sum += data[c];

EN | Notice that the data is evenly distributed between 0 and 255. When the data is sorted, roughly the first half of the iterations will not enter the if-statement. After that, they will all enter the if-statement. This is very friendly to the branch predictor since the branch consecutively goes the same direction many times.
VI | Để ý rằng dữ liệu được phân bố đều giữa 0 và 255. Khi dữ liệu được sắp xếp, khoảng nửa số vòng lặp đầu tiên sẽ không đi vào câu lệnh if. Sau đó, tất cả chúng đều sẽ đi vào câu lệnh if. Điều này rất thân thiện với bộ dự đoán nhánh vì nhánh liên tiếp đi theo cùng một hướng nhiều lần.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## docker-multistage
docs · Multi-stage builds · https://docs.docker.com/build/building/multi-stage/

EN | Multi-stage builds
VI | Build nhiều giai đoạn

EN | Multi-stage builds are useful to anyone who has struggled to optimize Dockerfiles while keeping them easy to read and maintain.
VI | Build nhiều giai đoạn hữu ích cho bất kỳ ai từng vật lộn để tối ưu Dockerfile mà vẫn giữ chúng dễ đọc và dễ bảo trì.

EN | Use multi-stage builds
VI | Sử dụng build nhiều giai đoạn

EN | With multi-stage builds, you use multiple `FROM` statements in your Dockerfile. Each `FROM` instruction can use a different base, and each of them begins a new stage of the build. You can selectively copy artifacts from one stage to another, leaving behind everything you don't want in the final image.
VI | Với build nhiều giai đoạn, bạn dùng nhiều câu lệnh `FROM` trong Dockerfile. Mỗi lệnh `FROM` có thể dùng một base khác nhau, và mỗi lệnh bắt đầu một giai đoạn build mới. Bạn có thể chọn lọc copy các artifact từ giai đoạn này sang giai đoạn khác, bỏ lại phía sau mọi thứ bạn không muốn có trong image cuối cùng.

EN | The following Dockerfile has two separate stages: one for building a binary, and another where the binary gets copied from the first stage into the next stage.
VI | Dockerfile sau có hai giai đoạn riêng biệt: một để build binary, và một giai đoạn khác nơi binary được copy từ giai đoạn đầu sang giai đoạn tiếp theo.

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
VI | Kết quả cuối cùng là một production image nhỏ gọn chỉ chứa mỗi binary. Không có công cụ build nào cần thiết để build ứng dụng được đưa vào image kết quả.

EN | How does it work? The second `FROM` instruction starts a new build stage with the `scratch` image as its base. The `COPY --from=0` line copies just the built artifact from the previous stage into this new stage. The Go SDK and any intermediate artifacts are left behind, and not saved in the final image.
VI | Cơ chế hoạt động ra sao? Lệnh `FROM` thứ hai bắt đầu một giai đoạn build mới với image `scratch` làm base. Dòng `COPY --from=0` chỉ copy artifact đã build từ giai đoạn trước vào giai đoạn mới này. Go SDK và mọi artifact trung gian đều bị bỏ lại, không được lưu trong image cuối cùng.

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
VI | *Pod* là đơn vị tính toán nhỏ nhất mà bạn có thể tạo và quản lý trong Kubernetes.

EN | A *Pod* (as in a pod of whales or pea pod) is a group of one or more containers, with shared storage and network resources, and a specification for how to run the containers. A Pod's contents are always co-located and co-scheduled, and run in a shared context. A Pod models an application-specific "logical host": it contains one or more application containers which are relatively tightly coupled. In non-cloud contexts, applications executed on the same physical or virtual machine are analogous to cloud applications executed on the same logical host.
VI | *Pod* (như trong "pod" cá voi hay vỏ đậu) là một nhóm gồm một hoặc nhiều container, chia sẻ tài nguyên lưu trữ và mạng, cùng một đặc tả về cách chạy các container đó. Nội dung của một Pod luôn được đặt cùng vị trí, lên lịch cùng nhau và chạy trong một ngữ cảnh chung. Pod mô phỏng một "máy chủ logic" dành riêng cho ứng dụng: nó chứa một hoặc nhiều container ứng dụng có mối liên kết tương đối chặt chẽ. Trong môi trường phi đám mây, các ứng dụng chạy trên cùng một máy vật lý hoặc máy ảo cũng tương tự như các ứng dụng đám mây chạy trên cùng một máy chủ logic.

EN | As well as application containers, a Pod can contain init containers that run during Pod startup. You can also inject ephemeral containers for debugging a running Pod.
VI | Ngoài các container ứng dụng, một Pod còn có thể chứa các init container chạy trong quá trình khởi động Pod. Bạn cũng có thể thêm các ephemeral container để gỡ lỗi một Pod đang chạy.

EN | What is a Pod?
VI | Pod là gì?

EN | The shared context of a Pod is a set of Linux namespaces, cgroups, and potentially other facets of isolation - the same things that isolate a container. Within a Pod's context, the individual applications may have further sub-isolations applied.
VI | Ngữ cảnh chung của một Pod là một tập hợp các Linux namespace, cgroup và có thể cả những khía cạnh cô lập khác — cũng chính là những thứ dùng để cô lập một container. Trong ngữ cảnh của Pod, từng ứng dụng riêng lẻ có thể được áp dụng thêm các lớp cô lập phụ.

EN | A Pod is similar to a set of containers with shared namespaces and shared filesystem volumes.
VI | Một Pod tương tự như một tập hợp các container có chung namespace và chung volume hệ thống tệp.

EN | Pods in a Kubernetes cluster are used in two main ways:
VI | Pod trong một cluster Kubernetes được sử dụng theo hai cách chính:

EN | *Pods that run a single container*. The "one-container-per-Pod" model is the most common Kubernetes use case; in this case, you can think of a Pod as a wrapper around a single container; Kubernetes manages Pods rather than managing the containers directly.
VI | *Pod chạy một container duy nhất*. Mô hình "một container cho mỗi Pod" là trường hợp sử dụng phổ biến nhất trong Kubernetes; trong trường hợp này, bạn có thể coi Pod như một lớp bao bọc quanh một container duy nhất; Kubernetes quản lý Pod thay vì quản lý trực tiếp các container.

EN | *Pods that run multiple containers that need to work together*. A Pod can encapsulate an application composed of [link]multiple co-located containers[/link] that are tightly coupled and need to share resources. These co-located containers form a single cohesive unit.
VI | *Pod chạy nhiều container cần phối hợp với nhau*. Một Pod có thể bao bọc một ứng dụng gồm [link]nhiều container được đặt cùng vị trí[/link] có liên kết chặt chẽ và cần chia sẻ tài nguyên. Các container cùng vị trí này tạo thành một đơn vị thống nhất.

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
VI | *Closure* là sự kết hợp của một hàm được gói lại (bao bọc) cùng với các tham chiếu đến trạng thái xung quanh nó (*môi trường lexical*). Nói cách khác, closure cho phép một hàm truy cập vào phạm vi bên ngoài của nó. Trong JavaScript, closure được tạo ra mỗi khi một hàm được tạo, vào thời điểm hàm được khởi tạo.

EN | Lexical scoping
VI | Phạm vi lexical

EN | Consider the following example code:
VI | Xét ví dụ mã sau:

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
VI | `init()` tạo một biến cục bộ tên là `name` và một hàm tên là `displayName()`. Hàm `displayName()` là một hàm bên trong được định nghĩa trong `init()` và chỉ có thể sử dụng trong thân của hàm `init()`. Lưu ý rằng hàm `displayName()` không có biến cục bộ nào của riêng nó. Tuy nhiên, vì các hàm bên trong có quyền truy cập vào các biến của phạm vi bên ngoài, `displayName()` có thể truy cập biến `name` được khai báo trong hàm cha, `init()`.

EN | If you run this code in your console, you can see that the `console.log()` statement within the `displayName()` function successfully displays the value of the `name` variable, which is declared in its parent function. This is an example of *lexical scoping*, which describes how a parser resolves variable names when functions are nested. The word *lexical* refers to the fact that lexical scoping uses the location where a variable is declared within the source code to determine where that variable is available. Nested functions have access to variables declared in their outer scope.
VI | Nếu bạn chạy mã này trong console, bạn có thể thấy rằng câu lệnh `console.log()` trong hàm `displayName()` hiển thị thành công giá trị của biến `name`, được khai báo trong hàm cha của nó. Đây là một ví dụ về *phạm vi lexical*, mô tả cách trình phân tích cú pháp phân giải tên biến khi các hàm được lồng vào nhau. Từ *lexical* đề cập đến việc phạm vi lexical sử dụng vị trí mà một biến được khai báo trong mã nguồn để xác định nơi biến đó có thể được sử dụng. Các hàm lồng nhau có quyền truy cập vào các biến được khai báo trong phạm vi bên ngoài của chúng.

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
VI | `Promise` là một đối tượng đại diện cho sự hoàn thành hoặc thất bại cuối cùng của một thao tác bất đồng bộ. Vì hầu hết mọi người chỉ là người tiêu thụ những promise đã được tạo sẵn, hướng dẫn này sẽ giải thích cách sử dụng promise được trả về trước khi giải thích cách tạo ra chúng.

EN | Essentially, a promise is a returned object to which you attach callbacks, instead of passing callbacks into a function. Imagine a function, `createAudioFileAsync()`, which asynchronously generates a sound file given a configuration record and two callback functions: one called if the audio file is successfully created, and the other called if an error occurs.
VI | Về cơ bản, promise là một đối tượng được trả về mà bạn gắn callback vào đó, thay vì truyền callback vào một hàm. Hãy tưởng tượng một hàm, `createAudioFileAsync()`, hàm này tạo ra một tệp âm thanh một cách bất đồng bộ dựa trên một bản ghi cấu hình và hai hàm callback: một hàm được gọi nếu tệp âm thanh được tạo thành công, và hàm kia được gọi nếu xảy ra lỗi.

EN | Here's some code that uses `createAudioFileAsync()`:
VI | Đây là một đoạn code sử dụng `createAudioFileAsync()`:

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
VI | Nếu `createAudioFileAsync()` được viết lại để trả về một promise, bạn sẽ gắn callback của mình vào đó thay vì truyền vào hàm:

CODE | createAudioFileAsync(audioSettings).then(successCallback, failureCallback);

EN | This convention has several advantages. We will explore each one.
VI | Cách làm này có một số lợi ích. Chúng ta sẽ cùng tìm hiểu từng lợi ích một.

EN | Chaining
VI | Chuỗi promise

EN | A common need is to execute two or more asynchronous operations back to back, where each subsequent operation starts when the previous operation succeeds, with the result from the previous step. In the old days, doing several asynchronous operations in a row would lead to the classic [link]callback hell[/link]:
VI | Một nhu cầu phổ biến là thực hiện hai hoặc nhiều thao tác bất đồng bộ liên tiếp nhau, trong đó mỗi thao tác tiếp theo bắt đầu khi thao tác trước đó thành công, với kết quả từ bước trước. Ngày xưa, việc thực hiện nhiều thao tác bất đồng bộ liên tiếp sẽ dẫn đến [link]địa ngục callback[/link] kinh điển:

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
VI | Đã áp dụng: Xây dựng một Executor

EN | Rust's `Future`s are lazy: they won't do anything unless actively driven to completion. One way to drive a future to completion is to `.await` it inside an `async` function, but that just pushes the problem one level up: who will run the futures returned from the top-level `async` functions? The answer is that we need a `Future` executor.
VI | `Future` trong Rust có tính lười (lazy): chúng sẽ không làm gì cả trừ khi được chủ động đẩy đến khi hoàn thành. Một cách để đẩy một future đến khi hoàn thành là `.await` nó bên trong một hàm `async`, nhưng điều đó chỉ đẩy vấn đề lên một cấp: ai sẽ chạy các future được trả về từ các hàm `async` ở cấp cao nhất? Câu trả lời là chúng ta cần một executor cho `Future`.

EN | `Future` executors take a set of top-level `Future`s and run them to completion by calling `poll` whenever the `Future` can make progress. Typically, an executor will `poll` a future once to start off. When `Future`s indicate that they are ready to make progress by calling `wake()`, they are placed back onto a queue and `poll` is called again, repeating until the `Future` has completed.
VI | Executor `Future` nhận một tập hợp các `Future` ở cấp cao nhất và chạy chúng đến khi hoàn thành bằng cách gọi `poll` mỗi khi `Future` có thể tiến triển. Thông thường, executor sẽ `poll` một future một lần để khởi động. Khi các `Future` báo hiệu rằng chúng sẵn sàng tiến triển bằng cách gọi `wake()`, chúng được đưa trở lại hàng đợi và `poll` được gọi lại, lặp đi lặp lại cho đến khi `Future` hoàn thành.

EN | In this section, we'll write our own simple executor capable of running a large number of top-level futures to completion concurrently.
VI | Trong phần này, chúng ta sẽ viết một executor đơn giản của riêng mình có khả năng chạy đồng thời một số lượng lớn các future cấp cao nhất đến khi hoàn thành.

EN | For this example, we depend on the `futures` crate for the `ArcWake` trait, which provides an easy way to construct a `Waker`. Edit `Cargo.toml` to add a new dependency:
VI | Đối với ví dụ này, chúng ta phụ thuộc vào crate `futures` cho trait `ArcWake`, cung cấp một cách dễ dàng để tạo một `Waker`. Chỉnh sửa `Cargo.toml` để thêm một dependency mới:

CODE | [package]
CODE | name = "timer_future"
CODE | version = "0.1.0"
CODE | authors = ["XYZ Author"]
CODE | edition = "2021"
CODE | 
CODE | [dependencies]
CODE | futures = "0.3"

EN | Our executor will work by sending tasks to run over a channel. The executor will pull events off of the channel and run them. When a task is ready to do more work (is awoken), it can schedule itself to be polled again by putting itself back onto the channel.
VI | Executor của chúng ta sẽ hoạt động bằng cách gửi các task cần chạy qua một channel. Executor sẽ lấy các sự kiện ra khỏi channel và chạy chúng. Khi một task sẵn sàng làm thêm việc (được đánh thức), nó có thể tự lên lịch để được poll lại bằng cách đưa chính nó trở lại channel.

EN | In this design, the executor itself just needs the receiving end of the task channel. The user will get a sending end so that they can spawn new futures. Tasks themselves are just futures that can reschedule themselves, so we'll store them as a future paired with a sender that the task can use to requeue itself.
VI | Trong thiết kế này, bản thân executor chỉ cần đầu nhận của channel task. Người dùng sẽ nhận được đầu gửi để họ có thể spawn các future mới. Bản thân các task chỉ là những future có thể tự lên lịch lại, vì vậy chúng ta sẽ lưu chúng dưới dạng một future đi kèm với một sender mà task có thể dùng để tự đưa mình trở lại hàng đợi.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-book-ownership
docs · What Is Ownership? · https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html

EN | What Is Ownership?
VI | Quyền sở hữu là gì?

EN | *Ownership* is a set of rules that govern how a Rust program manages memory. All programs have to manage the way they use a computer’s memory while running. Some languages have garbage collection that regularly looks for no-longer-used memory as the program runs; in other languages, the programmer must explicitly allocate and free the memory. Rust uses a third approach: Memory is managed through a system of ownership with a set of rules that the compiler checks. If any of the rules are violated, the program won’t compile. None of the features of ownership will slow down your program while it’s running.
VI | *Quyền sở hữu* là một tập hợp các quy tắc chi phối cách một chương trình Rust quản lý bộ nhớ. Mọi chương trình đều phải quản lý cách chúng sử dụng bộ nhớ của máy tính trong khi chạy. Một số ngôn ngữ có cơ chế thu gom rác (garbage collection) thường xuyên tìm kiếm những vùng bộ nhớ không còn được dùng đến trong khi chương trình chạy; ở những ngôn ngữ khác, lập trình viên phải tự cấp phát và giải phóng bộ nhớ một cách tường minh. Rust sử dụng cách tiếp cận thứ ba: Bộ nhớ được quản lý thông qua một hệ thống sở hữu với một tập hợp các quy tắc mà trình biên dịch kiểm tra. Nếu bất kỳ quy tắc nào bị vi phạm, chương trình sẽ không biên dịch được. Không có tính năng nào của quyền sở hữu làm chậm chương trình của bạn trong khi chạy.

EN | Because ownership is a new concept for many programmers, it does take some time to get used to. The good news is that the more experienced you become with Rust and the rules of the ownership system, the easier you’ll find it to naturally develop code that is safe and efficient. Keep at it!
VI | Vì quyền sở hữu là một khái niệm mới đối với nhiều lập trình viên, nên phải mất một thời gian mới quen được. Tin tốt là càng có kinh nghiệm với Rust và các quy tắc của hệ thống sở hữu, bạn sẽ càng thấy dễ dàng hơn trong việc tự nhiên viết ra những đoạn mã an toàn và hiệu quả. Hãy kiên trì nhé!

EN | Both the stack and the heap are parts of memory available to your code to use at runtime, but they are structured in different ways. The stack stores values in the order it gets them and removes the values in the opposite order. This is referred to as *last in, first out (LIFO)*. Think of a stack of plates: When you add more plates, you put them on top of the pile, and when you need a plate, you take one off the top. Adding or removing plates from the middle or bottom wouldn’t work as well!
VI | Cả stack lẫn heap đều là những phần bộ nhớ mà mã của bạn có thể sử dụng trong lúc chạy, nhưng chúng được tổ chức theo những cách khác nhau. Stack lưu trữ các giá trị theo thứ tự nó nhận được và loại bỏ các giá trị theo thứ tự ngược lại. Điều này được gọi là *vào sau, ra trước (last in, first out – LIFO)*. Hãy nghĩ đến một chồng đĩa: Khi bạn thêm đĩa, bạn đặt chúng lên trên cùng của chồng, và khi cần một chiếc đĩa, bạn lấy một chiếc từ trên cùng xuống. Thêm hoặc bớt đĩa từ giữa hoặc từ dưới cùng sẽ không ổn chút nào!

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## rust-book-panic
docs · To panic! or Not to panic! · https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html

EN | To `panic!` or Not to `panic!`
VI | Nên `panic!` hay không nên `panic!`

EN | So, how do you decide when you should call `panic!` and when you should return `Result`? When code panics, there’s no way to recover. You could call `panic!` for any error situation, whether there’s a possible way to recover or not, but then you’re making the decision that a situation is unrecoverable on behalf of the calling code. When you choose to return a `Result` value, you give the calling code options. The calling code could choose to attempt to recover in a way that’s appropriate for its situation, or it could decide that an `Err` value in this case is unrecoverable, so it can call `panic!` and turn your recoverable error into an unrecoverable one. Therefore, returning `Result` is a good default choice when you’re defining a function that might fail.
VI | Vậy làm sao để quyết định khi nào nên gọi `panic!` và khi nào nên trả về `Result`? Khi code panic, không có cách nào để phục hồi. Bạn có thể gọi `panic!` cho bất kỳ tình huống lỗi nào, dù có cách phục hồi hay không, nhưng làm vậy nghĩa là bạn đang thay code gọi hàm quyết định rằng tình huống đó không thể phục hồi. Khi bạn chọn trả về giá trị `Result`, bạn trao quyền lựa chọn cho code gọi hàm. Code gọi hàm có thể chọn cố gắng phục hồi theo cách phù hợp với tình huống của nó, hoặc có thể quyết định rằng giá trị `Err` trong trường hợp này là không thể phục hồi, nên nó có thể gọi `panic!` và biến lỗi có thể phục hồi của bạn thành lỗi không thể phục hồi. Vì vậy, trả về `Result` là lựa chọn mặc định tốt khi bạn định nghĩa một hàm có thể thất bại.

EN | In situations such as examples, prototype code, and tests, it’s more appropriate to write code that panics instead of returning a `Result`.
VI | Trong những tình huống như ví dụ, code nguyên mẫu (prototype) và kiểm thử, viết code panic lại phù hợp hơn là trả về `Result`.

EN | Examples, Prototype Code, and Tests
VI | Ví dụ, Code nguyên mẫu và Kiểm thử

EN | When you’re writing an example to illustrate some concept, also including robust error-handling code can make the example less clear. In examples, it’s understood that a call to a method like `unwrap` that could panic is meant as a placeholder for the way you’d want your application to handle errors, which can differ based on what the rest of your code is doing.
VI | Khi bạn viết một ví dụ để minh họa một khái niệm nào đó, việc thêm cả code xử lý lỗi chặt chẽ có thể làm ví dụ kém rõ ràng hơn. Trong các ví dụ, người ta hiểu rằng một lời gọi đến phương thức như `unwrap` có thể panic chỉ là chỗ giữ chỗ cho cách bạn muốn ứng dụng của mình xử lý lỗi, mà cách đó có thể khác nhau tùy vào phần còn lại của code đang làm gì.

EN | Similarly, the `unwrap` and `expect` methods are very handy when you’re prototyping and you’re not yet ready to decide how to handle errors. They leave clear markers in your code for when you’re ready to make your program more robust.
VI | Tương tự, các phương thức `unwrap` và `expect` rất tiện lợi khi bạn đang tạo nguyên mẫu và chưa sẵn sàng quyết định cách xử lý lỗi. Chúng để lại những dấu hiệu rõ ràng trong code cho lúc bạn sẵn sàng làm cho chương trình chặt chẽ hơn.

EN | If a method call fails in a test, you’d want the whole test to fail, even if that method isn’t the functionality under test. Because `panic!` is how a test is marked as a failure, calling `unwrap` or `expect` is exactly what should happen.
VI | Nếu một lời gọi phương thức thất bại trong một bài kiểm thử, bạn sẽ muốn toàn bộ bài kiểm thử đó thất bại, kể cả khi phương thức đó không phải là chức năng đang được kiểm thử. Vì `panic!` là cách đánh dấu một bài kiểm thử là thất bại, nên gọi `unwrap` hoặc `expect` chính xác là điều nên làm.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-not-a-dictionary
docs · Wikipedia:Wikipedia is not a dictionary · https://en.wikipedia.org/wiki/Wikipedia:Wikipedia_is_not_a_dictionary

EN | Wikipedia is not a dictionary, phrasebook, or a slang, jargon, or usage guide. Instead, the goal of this project is to create an encyclopedia. Our sister project Wiktionary aims to create a dictionary. It is the "lexical companion to Wikipedia", and the two often link to each other. Wiktionary welcomes all editors who wish to write a dictionary.
VI | Wikipedia không phải là từ điển, sổ tay thành ngữ, hay cẩm nang về tiếng lóng, thuật ngữ chuyên ngành hay cách dùng từ. Thay vào đó, mục tiêu của dự án này là tạo ra một bách khoa toàn thư. Dự án chị em của chúng ta là Wiktionary hướng đến việc tạo ra một từ điển. Đây là "người bạn đồng hành về mặt từ vựng của Wikipedia", và cả hai thường liên kết với nhau. Wiktionary chào đón tất cả những biên tập viên muốn viết từ điển.

EN | Both dictionary entries at Wiktionary and encyclopedia articles at Wikipedia may start as stubs, but they are works in progress, to be expanded. Wikipedia articles should begin with a good definition, but they should provide other types of information about that topic as well. The full articles that Wikipedia's stubs grow into are very different from dictionary entries.
VI | Cả mục từ trong Wiktionary lẫn bài viết bách khoa trong Wikipedia đều có thể bắt đầu dưới dạng bài sơ khai, nhưng chúng là những tác phẩm đang được hoàn thiện để mở rộng thêm. Bài viết Wikipedia nên bắt đầu bằng một định nghĩa tốt, nhưng cũng nên cung cấp các loại thông tin khác về chủ đề đó. Những bài viết hoàn chỉnh mà các bài sơ khai của Wikipedia phát triển thành rất khác so với mục từ trong từ điển.

EN | Each article in an encyclopedia is about a person, people, a concept, a place, an event, a thing, etc., whereas a dictionary entry is primarily about a word, an idiom, or a term and its meaning(s), usage and history.
VI | Mỗi bài viết trong bách khoa toàn thư nói về một người, một nhóm người, một khái niệm, một địa điểm, một sự kiện, một sự vật, v.v., trong khi mục từ trong từ điển chủ yếu nói về một từ, một thành ngữ hay một thuật ngữ cùng (các) nghĩa, cách dùng và lịch sử của nó.

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
VI | Gofmt là công cụ tự động định dạng mã nguồn Go.

EN | Gofmt'd code is:
VI | Mã đã được gofmt định dạng thì:

EN | easier to *write*: never worry about minor formatting concerns while hacking away,
VI | dễ *viết* hơn: không bao giờ phải bận tâm về những chuyện định dạng nhỏ nhặt trong lúc mải mê code,

EN | easier to *read*: when all code looks the same you need not mentally convert others' formatting style into something you can understand.
VI | dễ *đọc* hơn: khi mọi đoạn code trông giống nhau, bạn không cần phải chuyển đổi trong đầu cách định dạng của người khác thành thứ mình có thể hiểu được.

EN | easier to *maintain*: mechanical changes to the source don't cause unrelated changes to the file's formatting; diffs show only the real changes.
VI | dễ *bảo trì* hơn: những thay đổi mang tính máy móc đối với mã nguồn không gây ra những thay đổi định dạng không liên quan trong file; diff chỉ hiển thị những thay đổi thực sự.

EN | *uncontroversial*: never have a debate about spacing or brace position ever again!
VI | *không gây tranh cãi*: không bao giờ phải tranh luận về khoảng trắng hay vị trí dấu ngoặc nữa!

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
VI | Tại GopherCon 2017, Russ Cox chính thức khởi động quá trình suy nghĩ về phiên bản lớn tiếp theo của Go qua bài nói chuyện [link]Tương lai của Go[/link]. Chúng tôi vẫn gọi ngôn ngữ tương lai này một cách không chính thức là Go 2, dù giờ đây chúng tôi hiểu rằng nó sẽ đến theo từng bước tăng dần chứ không phải bằng một vụ nổ lớn và một bản phát hành chính duy nhất. Dẫu vậy, Go 2 vẫn là một cách gọi hữu ích, chỉ để có cách nói về ngôn ngữ tương lai đó, nên cứ tạm dùng nó trong lúc này.

EN | A major difference between Go 1 and Go 2 is who is going to influence the design and how decisions are made. Go 1 was a small team effort with modest outside influence; Go 2 will be much more community-driven. After almost 10 years of exposure, we have learned a lot about the language and libraries that we didn’t know in the beginning, and that was only possible through feedback from the Go community.
VI | Một khác biệt lớn giữa Go 1 và Go 2 là ai sẽ gây ảnh hưởng đến thiết kế và các quyết định được đưa ra như thế nào. Go 1 là nỗ lực của một nhóm nhỏ với ảnh hưởng từ bên ngoài khiêm tốn; Go 2 sẽ do cộng đồng dẫn dắt nhiều hơn hẳn. Sau gần 10 năm tiếp xúc, chúng tôi đã học được rất nhiều về ngôn ngữ và các thư viện mà ban đầu chúng tôi chưa biết, và điều đó chỉ có thể có được nhờ phản hồi từ cộng đồng Go.

EN | In 2015 we introduced the proposal process to gather a specific kind of feedback: proposals for language and library changes. A committee composed of senior Go team members has been reviewing, categorizing, and deciding on incoming proposals on a regular basis. That has worked pretty well, but as part of that process we have ignored all proposals that are not backward-compatible, simply labeling them Go 2 instead.
VI | Năm 2015, chúng tôi giới thiệu quy trình đề xuất để thu thập một loại phản hồi cụ thể: các đề xuất thay đổi ngôn ngữ và thư viện. Một ủy ban gồm các thành viên cấp cao của nhóm Go đã thường xuyên xem xét, phân loại và quyết định các đề xuất gửi đến. Cách đó đã hoạt động khá tốt, nhưng trong quy trình đó, chúng tôi đã bỏ qua mọi đề xuất không tương thích ngược, chỉ đơn giản gán nhãn chúng là Go 2.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-dont-bite-newcomers
opinion · Wikipedia:Please do not bite the newcomers · https://en.wikipedia.org/wiki/Wikipedia:Please_do_not_bite_the_newcomers

EN | Wikipedia is improved through the work of both regular editors and newcomers. All of us were new editors once, and in some areas, the most experienced are still regarded as newcomers. Treat newcomers with kindness and patience—nothing scares valuable contributors away faster than hostility.
VI | Wikipedia được cải thiện nhờ công sức của cả những biên tập viên thường xuyên lẫn những người mới. Tất cả chúng ta đều từng là người mới, và ở một số lĩnh vực, ngay cả những người dày dạn kinh nghiệm nhất vẫn bị coi là người mới. Hãy đối xử với người mới bằng sự tử tế và kiên nhẫn—không gì xua đuổi những cộng tác viên quý giá nhanh hơn sự thù địch.

EN | The first edits of many currently experienced editors were test edits, unsourced and/or unencyclopedic additions. As a result, it is unlikely for a new editor to be familiar with Wikipedia's markup language and its policies, guidelines, and community standards. Not having a clue is a normal stage in the editor life cycle. We want editors to survive the process.
VI | Những sửa đổi đầu tiên của rất nhiều biên tập viên dày dạn kinh nghiệm hiện nay từng là những sửa đổi thử nghiệm, những bổ sung không có nguồn và/hoặc không mang tính bách khoa. Vì vậy, một biên tập viên mới khó có thể đã quen với ngôn ngữ đánh dấu của Wikipedia cũng như các quy định, hướng dẫn và chuẩn mực cộng đồng ở đây. Không biết gì là một giai đoạn bình thường trong vòng đời của một biên tập viên. Chúng ta muốn các biên tập viên vượt qua được quá trình này.

EN | Initial interactions set the expectation for the entire community. A welcoming atmosphere invites new editors to mature, while a harsh one fosters an idea that Wikipedia is unkind and rigid.
VI | Những tương tác ban đầu định hình kỳ vọng cho toàn bộ cộng đồng. Một bầu không khí chào đón mời gọi người mới trưởng thành, trong khi một bầu không khí khắc nghiệt nuôi dưỡng ý nghĩ rằng Wikipedia là nơi không tử tế và cứng nhắc.

EN | Next time you feel frustrated with a newcomer's mistake, take it as an opportunity to nurture potential contributors. Consider improving upon a newcomer's edit rather than reverting it. Wikipedia needs a constant stream of new information, experience, and ideas. Guide newcomers patiently and thoroughly: kindness and patience is a necessity for Wikipedia's survival.
VI | Lần tới khi bạn thấy bực bội vì lỗi của một người mới, hãy coi đó là cơ hội để vun đắp những cộng tác viên tiềm năng. Hãy cân nhắc cải thiện sửa đổi của người mới thay vì lùi lại. Wikipedia cần một dòng chảy liên tục thông tin, kinh nghiệm và ý tưởng mới. Hãy hướng dẫn người mới một cách kiên nhẫn và kỹ càng: sự tử tế và kiên nhẫn là điều thiết yếu để Wikipedia tồn tại.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-template-regulars
opinion · Wikipedia:Don't template the regulars · https://en.wikipedia.org/wiki/Wikipedia:Don%27t_template_the_regulars

EN | Wikipedia offers many user talk templates to warn users about possible violations of vandalism, the three-revert rule, and other policies and guidelines. You should use these templates carefully.
VI | Wikipedia cung cấp nhiều bản mẫu nhắn tin cho thành viên để cảnh báo về các hành vi có thể vi phạm như phá hoại, quy tắc ba lần hồi sửa, và các quy định, hướng dẫn khác. Bạn nên sử dụng những bản mẫu này một cách cẩn thận.

EN | These templates explain the various policies to new editors. When novice editors breach policies, it is quite possible (if we assume good faith, which we must) that they are unaware of them, and educating them is helpful. On the other hand, most editors who have been around for a while are aware of these policies. If you believe that they have broken (or are about to breach) one, it may be the result of some disagreement over the interpretation of the policy, or temporarily heated tempers. In such situations, the "did you know we had a policy here" approach can be counterproductive in resolving the issue, as it can be construed as being patronising and uncivil.
VI | Những bản mẫu này giải thích các quy định khác nhau cho thành viên mới. Khi người mới vi phạm quy định, hoàn toàn có thể xảy ra trường hợp (nếu chúng ta giả định thiện chí, điều mà chúng ta buộc phải làm) là họ không biết về những quy định đó, và việc hướng dẫn họ là hữu ích. Mặt khác, hầu hết những thành viên đã tham gia một thời gian đều biết rõ các quy định này. Nếu bạn cho rằng họ đã vi phạm (hoặc sắp vi phạm) một quy định nào đó, thì rất có thể nguyên nhân là do bất đồng về cách hiểu quy định, hoặc do tạm thời nóng giận. Trong những tình huống như vậy, cách tiếp cận kiểu "bạn có biết ở đây có quy định này không" có thể phản tác dụng trong việc giải quyết vấn đề, vì nó có thể bị coi là lên giọng dạy đời và thiếu văn minh.

EN | The problem with templated messages
VI | Vấn đề với các tin nhắn dùng bản mẫu

EN | Template warnings are very generic, and sometimes out of date. Sometimes a template says never to do something which is nevertheless allowed in certain circumstances. Theoretically speaking, all things are allowed in some conceivable circumstance under Ignore All Rules. Sometimes Wikipedia has multiple policies which are contradictory. If a policy violation is not clear-cut, an amicable resolution to the problem is going to require a human explanation, not an automated template.
VI | Cảnh báo bằng bản mẫu rất chung chung, và đôi khi đã lỗi thời. Đôi khi một bản mẫu nói rằng không bao giờ được làm điều gì đó, trong khi điều đó vẫn được cho phép trong một số hoàn cảnh nhất định. Về mặt lý thuyết, mọi thứ đều được cho phép trong một hoàn cảnh nào đó có thể hình dung được, theo quy tắc Bỏ qua mọi quy tắc. Đôi khi Wikipedia có nhiều quy định mâu thuẫn với nhau. Nếu một vi phạm quy định không rõ ràng, thì để giải quyết vấn đề một cách thân thiện sẽ cần đến lời giải thích của con người, chứ không phải một bản mẫu tự động.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## bierce-devils-dictionary
humor · The Devil's Dictionary (selected entries) · https://www.gutenberg.org/ebooks/972

EN | BORE, n. A person who talks when you wish him to listen.
VI | KẺ NHÀM CHÁN, danh từ. Một người nói khi bạn muốn hắn ta nghe.

EN | CYNIC, n. A blackguard whose faulty vision sees things as they are, not as they ought to be. Hence the custom among the Scythians of plucking out a cynic's eyes to improve his vision.
VI | KẺ HOÀI NGHI, danh từ. Một kẻ ti tiện với thị lực khiếm khuyết nhìn thấy sự vật đúng như chúng vốn có, chứ không phải như chúng đáng phải là. Do đó mới có tục lệ của người Scythia là móc mắt kẻ hoài nghi để cải thiện thị lực của hắn.

EN | DIPLOMACY, n. The patriotic art of lying for one's country.
VI | NGOẠI GIAO, danh từ. Nghệ thuật yêu nước của việc nói dối vì đất nước mình.

EN | HAPPINESS, n. An agreeable sensation arising from contemplating the misery of another.
VI | HẠNH PHÚC, danh từ. Một cảm giác dễ chịu nảy sinh từ việc ngẫm nghĩ về nỗi khổ của người khác.

EN | LAWYER, n. One skilled in circumvention of the law.
VI | LUẬT SƯ, danh từ. Kẻ thành thạo trong việc lách luật.

EN | POLITICS, n. A strife of interests masquerading as a contest of principles. The conduct of public affairs for private advantage.
VI | CHÍNH TRỊ, danh từ. Cuộc tranh đấu của các lợi ích được ngụy trang thành cuộc thi đua của các nguyên tắc. Việc điều hành công việc công vì lợi ích tư.

EN | POLITICIAN, n. An eel in the fundamental mud upon which the superstructure of organized society is reared. When he wriggles he mistakes the agitation of his tail for the trembling of the edifice.
VI | CHÍNH KHÁCH, danh từ. Một con lươn trong lớp bùn nền móng mà trên đó cả tòa nhà xã hội có tổ chức được dựng lên. Khi nó ngọ nguậy, nó nhầm tưởng sự rung động của cái đuôi mình là sự chấn động của cả tòa nhà.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## pep20-zen
humor · PEP 20 – The Zen of Python · https://peps.python.org/pep-0020/

EN | The Zen of Python
VI | Thiền của Python

EN | Long time Pythoneer Tim Peters succinctly channels the BDFL's guiding principles for Python's design into 20 aphorisms, only 19 of which have been written down.
VI | Lập trình viên Python kỳ cựu Tim Peters đã cô đọng những nguyên tắc chỉ đạo của BDFL cho thiết kế Python thành 20 câu châm ngôn, nhưng chỉ có 19 câu được viết ra.

EN | Beautiful is better than ugly.
VI | Đẹp tốt hơn xấu.

EN | Explicit is better than implicit.
VI | Rõ ràng tốt hơn ngầm hiểu.

EN | Simple is better than complex.
VI | Đơn giản tốt hơn phức tạp.

EN | Complex is better than complicated.
VI | Phức tạp tốt hơn rối rắm.

EN | Flat is better than nested.
VI | Phẳng tốt hơn lồng nhau.

EN | Sparse is better than dense.
VI | Thưa thoáng tốt hơn dày đặc.

EN | Readability counts.
VI | Khả năng đọc hiểu rất quan trọng.

EN | Special cases aren't special enough to break the rules.
VI | Các trường hợp đặc biệt không đủ đặc biệt để phá vỡ quy tắc.

EN | Although practicality beats purity.
VI | Dù tính thực dụng vẫn hơn sự thuần khiết.

EN | Errors should never pass silently.
VI | Lỗi không bao giờ được phép lặng lẽ bỏ qua.

EN | Unless explicitly silenced.
VI | Trừ khi được im lặng một cách rõ ràng.

EN | In the face of ambiguity, refuse the temptation to guess.
VI | Khi đối mặt với sự mơ hồ, hãy từ chối cám dỗ đoán mò.

EN | There should be one-- and preferably only one --obvious way to do it.
VI | Nên có một-- và tốt nhất là chỉ một --cách rõ ràng để làm điều đó.

EN | Although that way may not be obvious at first unless you're Dutch.
VI | Dù cách đó có thể không rõ ràng ngay từ đầu trừ khi bạn là người Hà Lan.

EN | Now is better than never.
VI | Bây giờ tốt hơn không bao giờ.

EN | Although never is often better than *right* now.
VI | Dù không bao giờ thường tốt hơn *ngay* bây giờ.

EN | If the implementation is hard to explain, it's a bad idea.
VI | Nếu việc triển khai khó giải thích, đó là ý tưởng tồi.

EN | If the implementation is easy to explain, it may be a good idea.
VI | Nếu việc triển khai dễ giải thích, đó có thể là ý tưởng hay.

EN | Namespaces are one honking great idea -- let's do more of those!
VI | Không gian tên là một ý tưởng cực kỳ tuyệt vời -- hãy làm thêm nhiều cái nữa!

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## so-regex-html
humor · RegEx match open tags except XHTML self-contained tags · https://stackoverflow.com/a/1732454

EN | You can't parse [X]HTML with regex. Because HTML can't be parsed by regex. Regex is not a tool that can be used to correctly parse HTML. As I have answered in HTML-and-regex questions here so many times before, the use of regex will not allow you to consume HTML. Regular expressions are a tool that is insufficiently sophisticated to understand the constructs employed by HTML. HTML is not a regular language and hence cannot be parsed by regular expressions. Regex queries are not equipped to break down HTML into its meaningful parts. Even enhanced irregular regular expressions as used by Perl are not up to the task of parsing HTML. You will never make me crack. HTML is a language of sufficient complexity that it cannot be parsed by regular expressions. Even Jon Skeet cannot parse HTML using regular expressions. Every time you attempt to parse HTML with regular expressions, the unholy child weeps the blood of virgins, and Russian hackers pwn your webapp. Parsing HTML with regex summons tainted souls into the realm of the living. HTML and regex go together like love, marriage, and ritual infanticide. The `<center>` cannot hold it is too late. The force of regex and HTML together in the same conceptual space will destroy your mind like so much watery putty.
VI | Bạn không thể parse [X]HTML bằng regex. Bởi vì HTML không thể được parse bằng regex. Regex không phải là công cụ có thể dùng để parse HTML một cách chính xác. Như tôi đã trả lời trong các câu hỏi về HTML-và-regex ở đây không biết bao nhiêu lần rồi, việc dùng regex sẽ không cho phép bạn xử lý HTML. Biểu thức chính quy là một công cụ không đủ tinh vi để hiểu các cấu trúc mà HTML sử dụng. HTML không phải là một ngôn ngữ chính quy, và do đó không thể được parse bằng biểu thức chính quy. Các truy vấn regex không được trang bị để phân tách HTML thành những phần có ý nghĩa của nó. Ngay cả những biểu thức chính quy bất quy tắc được tăng cường như loại Perl dùng cũng không đủ sức để parse HTML. Bạn sẽ không bao giờ khiến tôi khuất phục được đâu. HTML là một ngôn ngữ có độ phức tạp đủ lớn đến mức không thể được parse bằng biểu thức chính quy. Ngay cả Jon Skeet cũng không thể parse HTML bằng biểu thức chính quy. Mỗi lần bạn cố parse HTML bằng biểu thức chính quy, đứa con bất thiện lại khóc ra máu của các trinh nữ, và hacker Nga pwn cái webapp của bạn. Parse HTML bằng regex là triệu hồi những linh hồn ô uế vào cõi người sống. HTML và regex đi với nhau như tình yêu, hôn nhân, và tục giết trẻ sơ sinh trong nghi lễ. Cái `<center>` không thể giữ được nữa, đã quá muộn rồi. Sức mạnh của regex và HTML cùng tồn tại trong một không gian khái niệm sẽ phá hủy tâm trí bạn như thể nó là một đống bùn nhão nhoét.

EN | Have you tried using an XML parser instead?
VI | Bạn đã thử dùng trình parse XML thay thế chưa?

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## swift-modest-proposal
humor · A Modest Proposal (closing section) · https://www.gutenberg.org/ebooks/1080

EN | I can think of no one objection, that will possibly be raised against this proposal, unless it should be urged, that the number of people will be thereby much lessened in the kingdom. This I freely own, and was indeed one principal design in offering it to the world. I desire the reader will observe, that I calculate my remedy for this one individual Kingdom of Ireland, and for no other that ever was, is, or, I think, ever can be upon Earth. Therefore let no man talk to me of other expedients: Of taxing our absentees at five shillings a pound: Of using neither clothes, nor houshold furniture, except what is of our own growth and manufacture: Of utterly rejecting the materials and instruments that promote foreign luxury: Of curing the expensiveness of pride, vanity, idleness, and gaming in our women: Of introducing a vein of parsimony, prudence and temperance: Of learning to love our country, wherein we differ even from Laplanders, and the inhabitants of Topinamboo: Of being a little cautious not to sell our country and consciences for nothing: Of teaching landlords to have at least one degree of mercy towards their tenants.
VI | Tôi không thể nghĩ ra bất kỳ lời phản đối nào có thể được nêu ra chống lại đề xuất này, trừ phi người ta viện cớ rằng dân số của vương quốc sẽ giảm đi đáng kể vì nó. Điều này tôi xin thẳng thắn thừa nhận, và thực tình đó cũng chính là một trong những mục đích chính khi tôi công bố nó với thiên hạ. Tôi mong độc giả lưu ý rằng tôi tính toán phương thuốc của mình cho riêng vương quốc Ireland này mà thôi, chứ không cho bất kỳ nơi nào khác từng tồn tại, đang tồn tại, hay theo tôi nghĩ, có thể tồn tại trên cõi đời này. Vậy nên đừng ai nói với tôi về những kế sách khác: nào là đánh thuế những kẻ sống xa quê năm shilling một pound; nào là không dùng quần áo hay đồ đạc trong nhà, trừ những thứ do chính ta trồng trọt và sản xuất; nào là hoàn toàn loại bỏ những nguyên liệu và công cụ nuôi dưỡng sự xa hoa ngoại lai; nào là chữa cái tính tiêu hoang vì kiêu căng, phù phiếm, lười biếng và cờ bạc ở phụ nữ chúng ta; nào là gieo vào lòng một nếp sống tiết kiệm, khôn ngoan và chừng mực; nào là học cách yêu quê hương mình, điều mà ta còn kém cả người Lapland và cư dân Topinamboo; nào là hãy cẩn trọng đôi chút, đừng bán rẻ quê hương và lương tâm mình chẳng vì gì cả; nào là dạy cho bọn địa chủ có ít nhất một chút lòng thương xót đối với tá điền của chúng.

EN | Therefore I repeat, let no man talk to me of these and the like expedients, till he hath at least some glympse of hope, that there will ever be some hearty and sincere attempt to put them into practice.
VI | Vì vậy tôi xin nhắc lại, đừng ai nói với tôi về những kế sách ấy và những thứ tương tự, cho đến khi người ta ít nhất cũng thấy một tia hy vọng rằng sẽ có một nỗ lực chân thành và tha thiết nào đó đưa chúng vào thực tế.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wodehouse-jeeves
humor · My Man Jeeves (Corky and his uncle Mr. Worple) · https://www.gutenberg.org/ebooks/8164

EN | You see, the catch about portrait-painting—I’ve looked into the thing a bit—is that you can’t start painting portraits till people come along and ask you to, and they won’t come and ask you to until you’ve painted a lot first. This makes it kind of difficult for a chappie.
VI | Bạn thấy đấy, cái khó của nghề vẽ chân dung — tôi cũng có tìm hiểu chút ít về chuyện này — là bạn không thể bắt đầu vẽ chân dung cho đến khi người ta đến nhờ bạn vẽ, mà người ta sẽ chẳng đến nhờ bạn cho đến khi bạn đã vẽ rất nhiều trước đó. Điều này khiến mọi chuyện hơi khó khăn cho một gã như tôi.

EN | Now, a great many fellows think that having a rich uncle is a pretty soft snap: but, according to Corky, such is not the case. Corky’s uncle was a robust sort of cove, who looked like living for ever. He was fifty-one, and it seemed as if he might go to par. It was not this, however, that distressed poor old Corky, for he was not bigoted and had no objection to the man going on living. What Corky kicked at was the way the above Worple used to harry him.
VI | Giờ thì, rất nhiều người nghĩ rằng có một ông chú giàu có là một điều khá dễ chịu: nhưng theo Corky thì không phải vậy. Chú của Corky là một lão khá rắn rỏi, trông như thể sống mãi không chết. Ông ta năm mươi mốt tuổi, và có vẻ như còn sống dài dài. Tuy nhiên, điều này không phải là thứ khiến Corky tội nghiệp đau khổ, vì anh ta không cố chấp và không phản đối việc ông ta tiếp tục sống. Điều Corky bực bội chính là cách mà lão Worple nói trên cứ hay quấy rầy anh ta.

EN | Corky’s uncle, you see, didn’t want him to be an artist. He didn’t think he had any talent in that direction. He was always urging him to chuck Art and go into the jute business and start at the bottom and work his way up. Jute had apparently become a sort of obsession with him. He seemed to attach almost a spiritual importance to it.
VI | Bạn thấy đấy, chú của Corky không muốn anh ta làm nghệ sĩ. Ông ta không nghĩ anh ta có chút tài năng nào theo hướng đó. Ông ta luôn thúc giục anh ta bỏ Nghệ thuật và nhảy vào ngành kinh doanh đay, bắt đầu từ vị trí thấp nhất rồi leo lên từng bước. Đay rõ ràng đã trở thành một thứ ám ảnh đối với ông ta. Ông ta dường như gán cho nó một tầm quan trọng gần như thuộc về tinh thần.

EN | Mr. Worple was peculiar in this respect. As a rule, from what I’ve observed, the American captain of industry doesn’t do anything out of business hours. When he has put the cat out and locked up the office for the night, he just relapses into a state of coma from which he emerges only to start being a captain of industry again. But Mr. Worple in his spare time was what is known as an ornithologist. He had written a book called *American Birds*, and was writing another, to be called *More American Birds*.
VI | Ông Worple đặc biệt ở điểm này. Theo những gì tôi quan sát được, thông thường thì các ông trùm công nghiệp Mỹ không làm gì ngoài giờ làm việc. Khi đã đuổi con mèo ra ngoài và khóa cửa văn phòng cho qua đêm, ông ta chỉ chìm vào trạng thái hôn mê mà từ đó ông ta chỉ tỉnh dậy để lại bắt đầu làm ông trùm công nghiệp một lần nữa. Nhưng ông Worple trong thời gian rảnh rỗi lại là một người được gọi là nhà điểu học. Ông ta đã viết một cuốn sách tên là *American Birds*, và đang viết thêm một cuốn nữa, sẽ có tên là *More American Birds*.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 

---

## wp-beans
humor · Wikipedia:Don't stuff beans up your nose · https://en.wikipedia.org/wiki/Wikipedia:Don%27t_stuff_beans_up_your_nose

EN | As an old story goes:
VI | Như một câu chuyện xưa kể rằng:

EN | The little boy's mother was going off to the market. She worried about her son, who was always up to some mischief. She sternly admonished him, "Be good. Don't get into trouble. Don't eat all the chocolate. Don't spill all the milk. Don't throw stones at the cow. Don't fall down the well." The boy had done all of these things on previous market days. Hoping to head off new trouble, she added, "And don't stuff beans up your nose!" This was a new idea for the boy, who promptly tried it out.
VI | Mẹ của cậu bé nọ chuẩn bị đi chợ. Bà lo lắng cho con trai mình, vì cậu luôn nghịch ngợm đủ trò. Bà nghiêm khắc dặn dò: "Ngoan ngoãn nhé. Đừng có gây chuyện. Đừng ăn hết sô-cô-la. Đừng làm đổ hết sữa. Đừng ném đá vào con bò. Đừng có ngã xuống giếng." Cậu bé đã từng làm đủ tất cả những trò đó trong những lần đi chợ trước. Mong ngăn chặn rắc rối mới, bà nói thêm: "Và đừng có nhét đậu vào mũi nhé!" Đó là một ý tưởng mới mẻ đối với cậu bé, và cậu liền thử ngay.

EN | In our zeal to head off others' unwise actions, we may put forth ideas they have not entertained before. As the popular saying goes, "don't give 'em any ideas".
VI | Trong lòng nhiệt thành muốn ngăn chặn những hành động dại dột của người khác, chúng ta có thể gieo vào đầu họ những ý tưởng mà trước đó họ chưa từng nghĩ tới. Như câu nói phổ biến vẫn nói, "đừng có gợi ý cho người ta".

EN | For example, if you are warning a vandal for one type of disruptive behavior, don't be tempted to go further and warn them in advance against something else that you think they might try next. It may not have occurred to them until you told them about it.
VI | Ví dụ, nếu bạn đang cảnh báo một kẻ phá hoại về một kiểu hành vi gây rối, đừng có ham mà đi xa hơn, cảnh báo trước với họ về một chuyện khác mà bạn nghĩ họ có thể sẽ thử tiếp theo. Biết đâu họ chưa từng nghĩ tới chuyện đó cho đến khi bạn nói ra.

fidelity: 
naturalness: 
tone: 
terminology: 
notes: 
