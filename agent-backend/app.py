from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import base64
import os
import uvicorn
import json
import logging
import httpx

from assistant import AIAssistant
from models import Appointment
from utils import parse_iso_datetime, send_email

# Initialize the app
app = FastAPI(
    title="Health Assistant API",
    description="API for interacting with the AI Health Assistant",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

assistant = AIAssistant()
logger = logging.getLogger(__name__)

# Pydantic models for request/response validation
class ChatRequest(BaseModel):
    user_id: str
    message: str

class ChatResponse(BaseModel):
    response: str
    transcribed_text: Optional[str] = None

class AppointmentCreate(BaseModel):
    user_id: str
    date_time: str  # ISO format
    purpose: str
    email: str

class AppointmentUpdate(BaseModel):
    date_time: Optional[str] = None
    purpose: Optional[str] = None
    email: Optional[str] = None

class AppointmentResponse(BaseModel):
    id: str
    user_id: str
    date_time: str
    purpose: str
    status: str
    email: Optional[str] = None
    email_sent: bool = False
    notification: Optional[str] = None

class VoiceRequest(BaseModel):
    user_id: str


# API endpoints
@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    """Process a chat message using the AI assistant"""
    try:
        response = assistant.process_query(request.message, request.user_id)
        return ChatResponse(response=response)
    except Exception as e:
        status_code = getattr(
            e,
            "status_code",
            getattr(getattr(e, "response", None), "status_code", None),
        )
        if status_code in (401, 403):
            logger.warning("Sarvam rejected the configured API key: %s", e)
            raise HTTPException(
                status_code=403,
                detail=(
                    "Sarvam rejected the API key. Check that the key is active "
                    "and has access to the Chat Completions API."
                ),
            ) from e
        if status_code == 429:
            logger.warning("Sarvam API quota or rate limit reached: %s", e)
            raise HTTPException(
                status_code=429,
                detail="Sarvam API quota or rate limit reached. Check the API key's project plan and usage.",
            ) from e
        logger.exception("Sarvam chat request failed")
        raise HTTPException(status_code=502, detail=f"Sarvam chat request failed: {e}") from e

@app.post("/appointments", response_model=AppointmentResponse)
async def create_appointment(appointment: AppointmentCreate):
    """Create an appointment and report whether its email confirmation was sent."""
    try:
        if not assistant._validate_email(appointment.email):
            raise HTTPException(status_code=422, detail="Please provide a valid email address.")
        date_time = parse_iso_datetime(appointment.date_time)
        new_appointment = assistant.health_assistant.create_appointment(
            user_id=appointment.user_id,
            date_time=date_time,
            purpose=appointment.purpose,
            email=appointment.email
        )
        email_body = f"""
            Dear Patient,
            Your appointment has been confirmed:
            Date: {date_time.strftime('%A, %B %d, %Y')}
            Time: {date_time.strftime('%I:%M %p')}
            Purpose: {appointment.purpose}
            Appointment ID: {new_appointment.id}
            If you need to reschedule or cancel, please contact us with your appointment ID.
            Thank you,
            Health Assistant Team
            """
        try:
            email_sent = send_email(
                to_email=appointment.email,
                subject="Appointment Confirmation",
                body=email_body,
            )
        except RuntimeError as email_error:
            logger.warning("Appointment saved but confirmation email failed: %s", email_error)
            notification = (
                "Appointment saved, but the confirmation email could not be sent: "
                f"{email_error}"
            )
        else:
            notification = f"Appointment saved and confirmation email sent to {appointment.email}."

        return AppointmentResponse(
            id=new_appointment.id,
            user_id=new_appointment.user_id,
            date_time=new_appointment.date_time.isoformat(),
            purpose=new_appointment.purpose,
            status=new_appointment.status,
            email=new_appointment.email,
            email_sent=email_sent,
            notification=notification,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid appointment date or time: {e}") from e
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error creating appointment")
        raise HTTPException(status_code=500, detail=f"Error creating appointment: {str(e)}") from e

@app.get("/appointments/{user_id}", response_model=List[AppointmentResponse])
async def get_appointments(user_id: str):
    """Get all appointments for a user"""
    try:
        appointments = assistant.health_assistant.get_appointments(user_id)
        return [
            AppointmentResponse(
                id=appt.id,
                user_id=appt.user_id,
                date_time=appt.date_time.isoformat(),
                purpose=appt.purpose,
                status=appt.status,
                email=appt.email
            ) for appt in appointments
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving appointments: {str(e)}")

@app.put("/appointments/{appointment_id}", response_model=AppointmentResponse)
async def update_appointment(appointment_id: str, update_data: AppointmentUpdate):
    """Update an existing appointment"""
    try:
        update_dict = {}
        if update_data.date_time:
            update_dict["date_time"] = parse_iso_datetime(update_data.date_time)
        if update_data.purpose:
            update_dict["purpose"] = update_data.purpose
        if update_data.email:
            update_dict["email"] = update_data.email
        
        updated = assistant.health_assistant.update_appointment(appointment_id, **update_dict)
        if not updated:
            raise HTTPException(status_code=404, detail="Appointment not found")
        
        return AppointmentResponse(
            id=updated.id,
            user_id=updated.user_id,
            date_time=updated.date_time.isoformat(),
            purpose=updated.purpose,
            status=updated.status,
            email=updated.email
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error updating appointment: {str(e)}")

@app.delete("/appointments/{appointment_id}", response_model=dict)
async def delete_appointment(appointment_id: str, reason: str = "User requested cancellation"):
    """Delete an appointment"""
    try:
        # First get the appointment to ensure it exists
        appointment = assistant.health_assistant.get_appointment(appointment_id)
        if not appointment:
            raise HTTPException(status_code=404, detail="Appointment not found")
            
        # Log cancellation reason
        assistant.health_assistant.log_cancellation_reason(appointment_id, reason)
        
        # Delete appointment
        success = assistant.health_assistant.delete_appointment(appointment_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete appointment")
            
        return {"message": "Appointment deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting appointment: {str(e)}")
    
@app.post("/voice-to-text", response_model=ChatResponse)
async def voice_to_text(
    user_id: str, 
    audio_file: UploadFile = File(...)
):
    """Transcribe voice input with Sarvam and process it with the assistant."""
    try:
        file_content = await audio_file.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                transcription_response = await client.post(
                    "https://api.sarvam.ai/speech-to-text",
                    headers={"api-subscription-key": assistant.api_key},
                    data={
                        "model": "saaras:v4",
                        "mode": "transcribe",
                        "language_code": "unknown",
                    },
                    files={
                        "file": (
                            audio_file.filename or "audio.webm",
                            file_content,
                            audio_file.content_type or "application/octet-stream",
                        )
                    },
                )
                transcription_response.raise_for_status()
        except httpx.HTTPStatusError as e:
            status_code = 429 if e.response.status_code == 429 else 502
            raise HTTPException(
                status_code=status_code,
                detail=f"Sarvam speech-to-text failed: {e.response.text}",
            ) from e

        text = transcription_response.json().get("transcript")
        if not isinstance(text, str) or not text.strip():
            raise HTTPException(
                status_code=502,
                detail="Sarvam returned an empty audio transcription",
            )

        response = assistant.process_query(text, user_id)
        return ChatResponse(
            response=response,
            transcribed_text=text
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Sarvam voice processing failed")
        raise HTTPException(status_code=502, detail=f"Sarvam voice processing failed: {str(e)}") from e


class ImageAnalysisResponse(BaseModel):
    analysis: str

@app.post("/analyze-image", response_model=ImageAnalysisResponse)
async def analyze_image(
    user_id: str,
    prompt: str = "What do you see in this medical image?",
    image_file: UploadFile = File(...)
):
    """Analyze an uploaded image with Groq; text chat remains on Sarvam."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Groq image analysis is not configured. Set GROQ_API_KEY in cred.env.",
        )

    content_type = image_file.content_type or ""
    if content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise HTTPException(
            status_code=415,
            detail="Unsupported image type. Upload a JPEG, PNG, WEBP, or GIF image.",
        )

    image_bytes = await image_file.read(10 * 1024 * 1024 + 1)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller.")

    image_data = base64.b64encode(image_bytes).decode("ascii")
    request_prompt = prompt.strip()
    if not request_prompt:
        raise HTTPException(status_code=422, detail="Image analysis prompt cannot be empty.")

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": os.getenv(
                        "GROQ_VISION_MODEL",
                        "qwen/qwen3.8-27b",
                    ),
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are a cautious medical image information assistant. "
                                "Describe visible features and provide general information, "
                                "but do not diagnose or replace a qualified clinician."
                            ),
                        },
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": request_prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{content_type};base64,{image_data}"
                                    },
                                },
                            ],
                        },
                    ],
                    "max_completion_tokens": 1024,
                    "temperature": 0.2,
                },
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as error:
        status_code = error.response.status_code
        if status_code == 429:
            logger.warning("Groq image analysis rate limit reached")
            raise HTTPException(
                status_code=429,
                detail="Groq image analysis rate limit reached. Check the API key's quota.",
            ) from error
        if status_code in (401, 403):
            logger.warning("Groq rejected the configured API key")
            raise HTTPException(
                status_code=502,
                detail="Groq rejected the configured API key or model access.",
            ) from error
        logger.error("Groq image analysis request failed with HTTP %s", status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Groq image analysis failed (HTTP {status_code}).",
        ) from error
    except httpx.RequestError as error:
        logger.exception("Could not reach Groq for image analysis")
        raise HTTPException(
            status_code=502,
            detail="Could not connect to Groq for image analysis.",
        ) from error

    try:
        analysis = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        logger.exception("Groq returned an invalid image analysis response")
        raise HTTPException(
            status_code=502,
            detail="Groq returned an invalid image analysis response.",
        ) from error
    if not isinstance(analysis, str) or not analysis.strip():
        raise HTTPException(
            status_code=502,
            detail="Groq returned an empty image analysis.",
        )
    return ImageAnalysisResponse(analysis=analysis.strip())

# Run the application
if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
