"""A request group shares one budget across envelope and part retries."""

from dataclasses import dataclass


MAX_RETRIES = 3


@dataclass
class RetryBudget:
    used: int = 0

    @property
    def available(self) -> bool:
        return self.used < MAX_RETRIES + 1
