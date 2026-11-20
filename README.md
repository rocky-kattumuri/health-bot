# A fully automated AI Health assistant 🩺
## Please watch this video becauase our backend free deploy service will not work accurately 
[Video](https://drive.google.com/file/d/1oEA1boUb3As-dRgqO_BoCHhEx3LJH6Ei/view?usp=drive_link)


A FastAPI-based application that provides an AI-powered health assistant for managing medical appointments, answering health-related questions, and analyzing medical images.

## Features

- 💬 Text-based chat interface for medical queries
- 🗣️ Voice-to-text input processing
- 📅 Appointment scheduling, modification, and cancellation
- 📧 Appointment confirmations sent to the email address entered when booking
- 🖼️ Medical image analysis with Groq; regular chat, voice transcription, and appointment tools use Sarvam

## Project Structure

```
ai-health-assistant/
├── app.py               # FastAPI application with all endpoints
├── assistant.py         # Core AI assistant functionality and agent setup
├── models.py            # Data models and storage logic
├── utils.py             # Utility functions for date parsing and email
├── main.py              # Command-line interface for testing
└── .env                 # Environment variables (create this)
```

## Prerequisites

- Python 3.9+
- Sarvam API key
- Groq API key for image analysis
- SMTP server access for email notifications

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/ai-health-assistant.git
   cd ai-health-assistant
   ```

2. Create a virtual environment and activate it:
   ```bash
   python -m venv venv
   # On Windows
   venv\Scripts\activate
   # On macOS/Linux
   source venv/bin/activate
   ```

3. Install required packages:
   ```bash
   pip install fastapi uvicorn pydantic langchain langchain-openai httpx python-dotenv python-multipart
   ```

## Configuration

Create a `.env` file in the project root with the following variables:

```
# Sarvam API key
SARVAM_API_KEY=your_sarvam_api_key_here
# Optional: choose sarvam-105b or sarvam-105b-conversations
# SARVAM_MODEL=sarvam-105b-conversations

# Groq vision API key (used only for image analysis)
GROQ_API_KEY=your_groq_api_key_here
# Optional: override the default Groq vision model
# GROQ_VISION_MODEL=qwen/qwen3.8-27b

# Email Configuration
EMAIL_SENDER=your_email@example.com
SMTP_PASSWORD=your_email_password_or_app_password
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
```

## Running the Application

### Command Line Interface

Run the Sarvam-powered assistant (requires `SARVAM_API_KEY`):

```bash
python main.py
```

### Web API

Start the FastAPI server:

```bash
uvicorn app:app --reload
```

The API will be available at http://localhost:8000

Interactive API documentation is available at:
- http://localhost:8000/docs (Swagger UI)
- http://localhost:8000/redoc (ReDoc)

## API Endpoints

### Chat

- **POST** `/chat`
  - Process text-based chat messages

### Voice Processing

- **POST** `/voice-to-text`
  - Convert audio recordings to text and process with the assistant

### Image Analysis

- **POST** `/analyze-image`
  - Analyzes uploaded images using Groq. Requires `GROQ_API_KEY`; regular text chat continues to use Sarvam.

### Appointments

- **POST** `/appointments`
  - Create a new appointment
- **GET** `/appointments/{user_id}`
  - List all appointments for a user
- **PUT** `/appointments/{appointment_id}`
  - Update an existing appointment
- **DELETE** `/appointments/{appointment_id}`
  - Cancel an appointment

## Usage Examples

### Chat Interaction

```python
import requests
import json

response = requests.post(
    "http://localhost:8000/chat",
    json={"user_id": "user123", "message": "What's the best way to treat a mild headache?"}
)
print(response.json()["response"])
```

### Schedule an Appointment

```python
import requests
from datetime import datetime, timedelta

# Schedule for tomorrow
appointment_time = (datetime.now() + timedelta(days=1)).isoformat()

response = requests.post(
    "http://localhost:8000/appointments",
    json={
        "user_id": "user123",
        "date_time": appointment_time,
        "purpose": "Annual check-up",
        "email": "patient@example.com"
    }
)
print(json.dumps(response.json(), indent=2))
```

### Voice Input

```python
import requests

with open("audio_recording.m4a", "rb") as f:
    files = {"audio_file": f}
    data = {"user_id": "user123"}
    response = requests.post("http://localhost:8000/voice-to-text", files=files, data=data)

print(response.json()["transcribed_text"])
print(response.json()["response"])
```

### Image Analysis

```python
import requests

with open("medical_image.jpg", "rb") as f:
    files = {"image_file": f}
    data = {
        "user_id": "user123", 
        "prompt": "What can you tell me about this skin rash?"
    }
    response = requests.post("http://localhost:8000/analyze-image", files=files, data=data)

print(response.json()["analysis"])
```

## Architecture

The application uses:

1. **FastAPI** - For the REST API endpoints
2. **LangChain** - For orchestrating the AI workflows
3. **Sarvam** - For natural language understanding, tool use, and speech-to-text
4. **Pydantic** - For data validation and settings management

## Security Considerations

- This application handles sensitive medical information. In a production environment, implement proper authentication, authorization, and encryption.
- Store API keys and credentials securely, never in the code.
- Consider HIPAA compliance requirements if deploying in the US healthcare context.

## Future Improvements

- Add user authentication system
- Implement persistent storage with a database
- Add health records management
- Integrate with calendaring systems
- Add follow-up reminders
- Implement real-time chat with WebSockets

## License

[MIT License]

## Acknowledgements

- Sarvam for language and speech models
- FastAPI for the web framework
- LangChain for the agent framework
