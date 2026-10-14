// Labelled pairs for the translation-memory provider's precision check: each query is tagged with
// the entry it is a rewording of, or with none when it is unrelated to every entry.
import type { MemoryExample } from '../types.ts';

export const MEMORY_ENTRIES: readonly MemoryExample[] = [
  { id: 'm.save', source: 'Click the Save button to store your changes.', target: 'Nhấn nút Lưu để lưu các thay đổi của bạn.' },
  { id: 'm.sched', source: 'The scheduler assigns tasks to idle workers.', target: 'Bộ lập lịch giao tác vụ cho các worker đang rảnh.' },
  { id: 'm.cache', source: 'Cached responses expire after sixty seconds.', target: 'Phản hồi được lưu đệm hết hạn sau sáu mươi giây.' },
  { id: 'm.cjk', source: '我们需要更新数据库的配置文件。', target: 'Chúng ta cần cập nhật tệp cấu hình của cơ sở dữ liệu.' },
];

export interface LabelledQuery {
  text: string;
  /** The entry it rewords, or undefined when it is unrelated to all of them. */
  entry: string | undefined;
}

export const MEMORY_QUERIES: readonly LabelledQuery[] = [
  { text: 'Click the Save button to keep your changes.', entry: 'm.save' },
  { text: 'Then click the Save button to store your changes.', entry: 'm.save' },
  { text: 'The scheduler assigns tasks to the idle workers.', entry: 'm.sched' },
  { text: 'Cached responses expire after about sixty seconds.', entry: 'm.cache' },
  { text: '我们需要更新数据库的配置文件吧。', entry: 'm.cjk' },
  { text: 'The weather in Hanoi is pleasant in autumn.', entry: undefined },
  { text: 'Photosynthesis converts light into chemical energy.', entry: undefined },
  { text: 'Click here to read the full story.', entry: undefined },
  { text: '今天天气很好我们去公园散步。', entry: undefined },
  { text: '', entry: undefined },
];
