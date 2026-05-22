#include "LogBuffer.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

namespace industrial_v2 {

LogBuffer gLogBuffer;

void LogBuffer::begin() {
  for (size_t index = 0; index < kLineCount; ++index) {
    lines_[index][0] = '\0';
  }
  writeIndex_ = 0;
  wrapped_ = false;
}

void LogBuffer::add(const char* message) {
  if (!message) return;
  strlcpy(lines_[writeIndex_], message, kLineSize);
  writeIndex_ = (writeIndex_ + 1U) % kLineCount;
  if (writeIndex_ == 0U) {
    wrapped_ = true;
  }
}

void LogBuffer::addf(const char* format, ...) {
  char buffer[kLineSize];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  add(buffer);
}

String LogBuffer::toText() const {
  String out;
  out.reserve(kLineCount * 48U);

  const size_t start = wrapped_ ? writeIndex_ : 0U;
  const size_t count = wrapped_ ? kLineCount : writeIndex_;

  for (size_t index = 0; index < count; ++index) {
    const size_t lineIndex = (start + index) % kLineCount;
    if (lines_[lineIndex][0] == '\0') continue;
    out += lines_[lineIndex];
    out += '\n';
  }

  return out;
}

}  // namespace industrial_v2
