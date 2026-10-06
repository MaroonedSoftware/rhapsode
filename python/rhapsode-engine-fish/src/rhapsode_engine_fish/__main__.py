"""`python -m rhapsode_engine_fish`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import FishEngine

if __name__ == "__main__":
    serve(FishEngine())
