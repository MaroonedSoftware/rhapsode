"""`python -m rhapsode_engine_styletts2`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import StyleTTS2Engine

if __name__ == "__main__":
    serve(StyleTTS2Engine())
