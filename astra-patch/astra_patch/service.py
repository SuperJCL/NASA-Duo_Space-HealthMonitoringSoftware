"""Local data-producer service; no Station/HUD application or transport."""
from fastapi import FastAPI
from .api import router
app=FastAPI(title='ASTRA Patch local acquisition and replay')
app.include_router(router)
