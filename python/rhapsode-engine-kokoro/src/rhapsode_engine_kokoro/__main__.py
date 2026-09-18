"""`python -m rhapsode_engine_kokoro`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import KokoroEngine

if __name__ == "__main__":
    serve(KokoroEngine())
