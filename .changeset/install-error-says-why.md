---
---

A failed install job's error names the line that says why, not the last line pip printed. A package built from source used to fail with pip's footer, such as `python exited 1: ╰─> llama-cpp-python`; it now fails with the build's own error, such as `CMake Error: CMAKE_CXX_COMPILER not set, after EnableLanguage (building llama-cpp-python)`. A certificate failure is named as one, where pip's last line said there was no matching distribution.
