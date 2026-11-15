"""Disabled delivery boundary. Original ASTRA prototype transport is not ported.

No network client, endpoint, credentials or enabling switch exists here.
"""
def deliver_pending(*args, **kwargs):
    return []
