"""`python -m rhapsode_engine_tone`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import ToneEngine

if __name__ == "__main__":
    serve(ToneEngine())
