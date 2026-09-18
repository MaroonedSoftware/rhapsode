"""`python -m rhapsode_engine_chatterbox`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import ChatterboxEngine

if __name__ == "__main__":
    serve(ChatterboxEngine())
