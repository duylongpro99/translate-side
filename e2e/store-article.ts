// The store article (fixtures/store/article.html) in real Vietnamese, for the screenshot specs.

/** What the mock answers for the article's blocks: real Vietnamese, so the images show the product, not `vi:` prefixes. */
export const VI: Record<string, string> = {
  "Keeping a small team's docs alive": 'Giữ cho tài liệu của một nhóm nhỏ luôn sống động',
  'A short guide for teams of five or fewer': 'Hướng dẫn ngắn cho các nhóm từ năm người trở xuống',
  'Most documentation does not fail because nobody wrote it. It fails because nobody noticed when it stopped being true. A page that was right in March is quietly wrong by June, and the people who trust it find out at the worst possible moment.':
    'Phần lớn tài liệu không hỏng vì không ai viết nó. Nó hỏng vì không ai nhận ra khi nó thôi đúng. Một trang đúng vào tháng Ba có thể đã lặng lẽ sai vào tháng Sáu, và những người tin vào nó chỉ biết điều đó vào lúc tệ nhất.',
  'Make the docs part of the change': 'Đưa tài liệu vào chính thay đổi',
  'The cheapest fix is to put the docs in the same repository as the code and review them in the same pull request. When a change alters behaviour, the reviewer asks one question: *which page does this make wrong?* If the answer is "none", the change ships. If not, the page is updated first.':
    'Cách rẻ nhất là đặt tài liệu trong cùng kho mã với mã nguồn và xem xét chúng trong cùng một pull request. Khi một thay đổi làm đổi hành vi, người xem xét chỉ hỏi một câu: *trang nào bị thay đổi này làm cho sai?* Nếu câu trả lời là "không trang nào", thay đổi được phát hành. Nếu không, trang đó được cập nhật trước.',
  'A doc that is not reviewed with the code will be reviewed by your users.': 'Tài liệu không được xem xét cùng với mã thì sẽ được chính người dùng của bạn xem xét.',
  'Give every page an owner': 'Giao mỗi trang cho một người phụ trách',
  'An owner is not the person who writes every word. It is the person who gets the message when the page is reported as wrong. Keep the list short and visible, and see the [link]owners handbook[/link] for a template.':
    'Người phụ trách không phải là người viết từng chữ. Đó là người nhận được tin nhắn khi trang bị báo là sai. Hãy giữ danh sách ngắn và dễ thấy, và xem [link]cẩm nang người phụ trách[/link] để lấy mẫu.',
  'Pick one owner per page, never a group.': 'Chọn một người phụ trách cho mỗi trang, đừng bao giờ chọn cả nhóm.',
  'Show the owner and the last review date at the top of the page.': 'Hiển thị người phụ trách và ngày xem xét gần nhất ở đầu trang.',
  'Rotate owners when someone changes teams.': 'Đổi người phụ trách khi ai đó chuyển nhóm.',
  'Check the examples, not just the prose': 'Kiểm tra cả ví dụ, không chỉ phần văn xuôi',
  "Examples rot fastest. Run them in your test suite, so a command that no longer works fails the build instead of a reader's afternoon.":
    'Ví dụ hỏng nhanh nhất. Hãy chạy chúng trong bộ kiểm thử, để một lệnh không còn chạy được làm hỏng bản dựng thay vì làm hỏng buổi chiều của người đọc.',
  'Teams that do this report fewer questions in chat and shorter onboarding. The habit costs about ten minutes a week.':
    'Các nhóm làm như vậy cho biết họ nhận ít câu hỏi hơn trong chat và việc làm quen nhanh hơn. Thói quen này tốn khoảng mười phút mỗi tuần.',
};
