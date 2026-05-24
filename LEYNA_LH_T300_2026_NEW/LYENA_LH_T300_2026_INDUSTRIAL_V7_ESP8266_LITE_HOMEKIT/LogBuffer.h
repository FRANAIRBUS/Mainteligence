#pragma once

#include <Arduino.h>

namespace industrial_v2 {

class LogBuffer {
 public:
  static constexpr size_t kLineCount = 24;
  static constexpr size_t kLineSize = 96;

  void begin();
  void add(const char* message);
  void addf(const char* format, ...);
  String toText() const;

 private:
  char lines_[kLineCount][kLineSize];
  size_t writeIndex_ = 0;
  bool wrapped_ = false;
};

extern LogBuffer gLogBuffer;

}  // namespace industrial_v2
