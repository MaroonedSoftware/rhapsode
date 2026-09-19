"""`python -m rhapsode_engine_dia`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import DiaEngine

if __name__ == "__main__":
    serve(DiaEngine())
