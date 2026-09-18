"""`python -m rhapsode_engine_orpheus`, which is how the core spawns it."""

from rhapsode_worker import serve

from .engine import OrpheusEngine

if __name__ == "__main__":
    serve(OrpheusEngine())
