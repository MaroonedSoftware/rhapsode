"""`python -m rhapsode_engine_breeze`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import BreezeEngine

if __name__ == "__main__":
    serve(BreezeEngine())
