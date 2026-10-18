"""Generate the synthetic dataset and train the flood-risk models.

Usage: python -m server.train            (about 1-2 minutes)
"""
from .generate_data import generate
from .model import train

if __name__ == "__main__":
    generate()
    train()
