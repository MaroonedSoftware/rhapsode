"""`python -m rhapsode_engine_phonon`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import PhononEngine

if __name__ == "__main__":
    serve(PhononEngine())
