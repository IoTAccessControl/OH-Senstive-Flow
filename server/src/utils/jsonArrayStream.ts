import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export type JsonArrayElementHandler = (value: unknown, index: number) => void;

const KEY_CAPTURE_LIMIT = 64;

type Mode = 'seek' | 'awaitArray' | 'inArray' | 'inElement';

/**
 * 流式读取形如 `{ "key": [ ... ], ... }` 的大 JSON 文件，按数组元素逐个解析并回调：
 * 不把整个文件读成单个字符串，不构建完整对象图，未注册的顶层 key 不解析。
 * 仅支持顶层为对象的 JSON；文件截断或顶层非对象时抛出异常。
 */
export async function forEachJsonArrayElement(
  filePath: string,
  handlers: Record<string, JsonArrayElementHandler>,
): Promise<void> {
  const wantedKeys = new Set(Object.keys(handlers));
  if (wantedKeys.size === 0) return;

  const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
  const decoder = new StringDecoder('utf8');

  let mode: Mode = 'seek';
  let depth = 0; // 顶层对象内部的对象嵌套深度
  let arrayDepth = 0; // 顶层对象内部被跳过数组的嵌套深度
  let inString = false;
  let escaped = false;
  let stringRaw = '';
  let stringOverflow = false;
  let pendingKey: string | null = null;
  let currentKey: string | null = null;
  let elemDepth = 0;
  let elemParts: string[] = [];
  let elemIndex = 0;
  let finished = false;

  const flushElement = (): void => {
    const text = elemParts.join('');
    elemParts = [];
    const handler = currentKey ? handlers[currentKey] : undefined;
    if (handler) {
      handler(JSON.parse(text), elemIndex);
      elemIndex += 1;
    }
  };

  const captureKeyChar = (char: string): void => {
    if (stringOverflow) return;
    if (stringRaw.length + char.length <= KEY_CAPTURE_LIMIT) {
      stringRaw += char;
    } else {
      stringRaw = '';
      stringOverflow = true;
    }
  };

  const onStringEnd = (): void => {
    pendingKey = depth === 1 && arrayDepth === 0 && !stringOverflow ? stringRaw : null;
    stringRaw = '';
    stringOverflow = false;
  };

  const processText = (text: string): void => {
    let i = 0;
    while (i < text.length && !finished) {
      if (inString) {
        let j = i;
        while (j < text.length && text[j] !== '"' && text[j] !== '\\') j += 1;
        const span = text.slice(i, j);
        if (mode === 'inElement') {
          if (span) elemParts.push(span);
        } else if (span) {
          captureKeyChar(span);
        }
        if (j >= text.length) {
          i = j;
          break;
        }
        const char = text[j];
        if (escaped) {
          escaped = false;
          if (mode === 'inElement') elemParts.push(char);
          else captureKeyChar(char);
        } else if (char === '\\') {
          escaped = true;
          if (mode === 'inElement') elemParts.push(char);
          else captureKeyChar(char);
        } else {
          inString = false;
          if (mode === 'inElement') elemParts.push(char);
          else onStringEnd();
        }
        i = j + 1;
        continue;
      }

      if (mode === 'inElement') {
        let j = i;
        while (j < text.length && text[j] !== '"' && text[j] !== '{' && text[j] !== '}' && text[j] !== '[' && text[j] !== ']' && text[j] !== ',') {
          j += 1;
        }
        if (j > i) elemParts.push(text.slice(i, j));
        if (j >= text.length) {
          i = j;
          break;
        }
        const char = text[j];
        i = j + 1;
        if (char === '"') {
          inString = true;
          elemParts.push(char);
          continue;
        }
        if (char === '{' || char === '[') {
          elemDepth += 1;
          elemParts.push(char);
          continue;
        }
        if (char === ',') {
          if (elemDepth > 0) {
            elemParts.push(char);
            continue;
          }
          flushElement();
          mode = 'inArray';
          continue;
        }
        if (char === '}' || char === ']') {
          if (elemDepth > 0) {
            elemDepth -= 1;
            elemParts.push(char);
            if (elemDepth === 0) {
              flushElement();
              mode = 'inArray';
            }
            continue;
          }
          if (char === ']') {
            flushElement();
            mode = 'seek';
            currentKey = null;
            continue;
          }
          elemParts.push(char);
          continue;
        }
        continue;
      }

      const char = text[i];
      i += 1;

      if (char === '"') {
        inString = true;
        stringRaw = '';
        stringOverflow = false;
        continue;
      }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') continue;

      if (mode === 'awaitArray') {
        if (char === '[') {
          mode = 'inArray';
          elemIndex = 0;
          elemDepth = 0;
          elemParts = [];
        } else {
          mode = 'seek';
          currentKey = null;
          pendingKey = null;
          i -= 1;
        }
        continue;
      }

      if (mode === 'inArray') {
        if (char === ',') continue;
        if (char === ']') {
          mode = 'seek';
          currentKey = null;
          continue;
        }
        mode = 'inElement';
        elemDepth = 0;
        elemParts = [];
        i -= 1;
        continue;
      }

      // mode === 'seek'
      if (char === ':') {
        if (pendingKey && wantedKeys.has(pendingKey)) {
          currentKey = pendingKey;
          mode = 'awaitArray';
        }
        pendingKey = null;
        continue;
      }

      if (char === '{') {
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth <= 0 && arrayDepth === 0) finished = true;
        continue;
      }
      if (char === '[') {
        arrayDepth += 1;
        continue;
      }
      if (char === ']') {
        if (arrayDepth > 0) arrayDepth -= 1;
        continue;
      }
    }
  };

  try {
    for await (const chunk of stream) {
      if (finished) break;
      processText(decoder.write(chunk as Buffer));
    }
    if (!finished) processText(decoder.end());
  } finally {
    stream.destroy();
  }

  if (!finished) {
    throw new Error(`JSON 文件不完整或不是合法的顶层对象：${filePath}`);
  }
}