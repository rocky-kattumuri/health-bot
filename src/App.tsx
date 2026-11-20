import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import {
  Mic,
  Send,
  Edit2,
  Trash2,
  RefreshCw,
  Upload,
  AlertCircle,
} from "lucide-react";

interface Message {
  text: string;
  sender: "user" | "assistant";
  isProcessing?: boolean;
}

interface Appointment {
  id: string;
  date_time: string;
  purpose: string;
  status: string;
  email?: string | null;
}

const API_URL =
  (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env
    .VITE_API_URL || "http://127.0.0.1:8000";
const USER_ID = "new_user";

function App() {
  const [activeTab, setActiveTab] = useState<"chat" | "appointments">("chat");
  const [messages, setMessages] = useState<Message[]>([
    {
      text: "Hello! I'm your health assistant. How can I help you today?",
      sender: "assistant",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState("0:00");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState<
    string | null
  >(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editAppointment, setEditAppointment] = useState<{
    id: string;
    date_time: string;
    purpose: string;
  } | null>(null);

  // New appointment form state
  const [newAppointment, setNewAppointment] = useState({
    date_time: new Date(Date.now() + 30 * 60000).toISOString().slice(0, 16),
    purpose: "",
    email: "",
  });

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout>();
  const recordingStartTimeRef = useRef<number>(0);

  useEffect(() => {
    if (activeTab === "appointments") {
      fetchAppointments();
    }
  }, [activeTab]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      mediaRecorderRef.current.addEventListener("dataavailable", (event) => {
        audioChunksRef.current.push(event.data);
      });

      mediaRecorderRef.current.addEventListener("stop", () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: "audio/webm",
        });
        processAudioRecording(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      });

      audioChunksRef.current = [];
      mediaRecorderRef.current.start();
      setIsRecording(true);
      recordingStartTimeRef.current = Date.now();
      startRecordingTimer();
    } catch (error) {
      console.error("Error accessing microphone:", error);
      setApiError(
        "Unable to access microphone. Please ensure you have granted microphone permissions."
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopRecordingTimer();
    }
  };

  const startRecordingTimer = () => {
    recordingTimerRef.current = setInterval(() => {
      const elapsed = Math.floor(
        (Date.now() - recordingStartTimeRef.current) / 1000
      );
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      setRecordingTime(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    }, 1000);
  };

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
  };

  const processAudioRecording = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append("audio_file", audioBlob, "recording.webm");

    setMessages((prev) => [
      ...prev,
      {
        text: "Processing your voice message...",
        sender: "assistant",
        isProcessing: true,
      },
    ]);

    try {
      const response = await fetch(
        `${API_URL}/voice-to-text?user_id=${USER_ID}`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Remove the processing message
      setMessages((prev) => prev.filter((msg) => !msg.isProcessing));

      if (data.transcribed_text) {
        setMessages((prev) => [
          ...prev,
          { text: data.transcribed_text, sender: "user" },
          { text: data.response, sender: "assistant" },
        ]);
        try {
          await syncAppointments();
        } catch (error) {
          console.error("Error syncing appointments after voice chat:", error);
          setApiError(
            "The voice reply was received, but appointments could not be refreshed."
          );
        }
      } else {
        throw new Error("No transcription received");
      }
    } catch (error) {
      console.error("Error processing voice recording:", error);
      setMessages((prev) => prev.filter((msg) => !msg.isProcessing));
      setMessages((prev) => [
        ...prev,
        {
          text: "Sorry, there was an error processing your voice message. Please try again or type your message instead.",
          sender: "assistant",
        },
      ]);
    }
  };

  const fetchAppointments = async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      const response = await fetch(`${API_URL}/appointments/${USER_ID}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setAppointments(data);
    } catch (error) {
      console.error("Error fetching appointments:", error);
      setApiError(
        "Unable to connect to the server. Please ensure the API server is running."
      );
      setAppointments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const syncAppointments = async () => {
    const response = await fetch(`${API_URL}/appointments/${USER_ID}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    setAppointments(data);
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    setCancellingAppointmentId(appointmentId);
    setApiError(null);
    try {
      const response = await fetch(
        `${API_URL}/appointments/${encodeURIComponent(appointmentId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        let detail = `Unable to cancel appointment (HTTP ${response.status}).`;
        try {
          const errorData = await response.json();
          if (typeof errorData.detail === "string") {
            detail = errorData.detail;
          }
        } catch {
          // Keep the HTTP status if the backend did not return JSON.
        }
        throw new Error(detail);
      }

      setAppointments((current) =>
        current.filter((appointment) => appointment.id !== appointmentId)
      );
      await syncAppointments();
    } catch (error) {
      console.error("Error cancelling appointment:", error);
      setApiError(
        error instanceof Error
          ? error.message
          : "Unable to cancel the appointment. Please try again."
      );
    } finally {
      setCancellingAppointmentId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isChatLoading) return;

    const message = inputMessage.trim();
    const newMessage = { text: message, sender: "user" as const };
    setMessages((prev) => [...prev, newMessage]);
    setInputMessage("");
    setIsChatLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, message }),
      });
      if (!response.ok) {
        let detail = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (typeof errorData.detail === "string") {
            detail = errorData.detail;
          }
        } catch {
          // Keep the HTTP status if the backend did not return JSON.
        }
        throw new Error(detail);
      }
      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { text: data.response, sender: "assistant" },
      ]);
      try {
        await syncAppointments();
      } catch (error) {
        console.error("Error syncing appointments after chat:", error);
        setApiError("The chat reply was received, but appointments could not be refreshed.");
      }
    } catch (error) {
      console.error("Error:", error);
      const message =
        error instanceof Error
          ? `Sorry, there was an error processing your request: ${error.message}`
          : "Sorry, there was an error processing your request.";
      setMessages((prev) => [
        ...prev,
        {
          text: message,
          sender: "assistant",
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) {
      setUploadStatus("Please select an image file.");
      return;
    }

    setUploadStatus("Uploading...");
    const formData = new FormData();
    formData.append("image_file", selectedFile);
    formData.append("prompt", "What do you see in this medical image?");

    try {
      const response = await fetch(
        `${API_URL}/analyze-image?user_id=${USER_ID}`,
        {
          method: "POST",
          body: formData,
        }
      );
      if (!response.ok) {
        let detail = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (typeof errorData.detail === "string") {
            detail = errorData.detail;
          }
        } catch {
          // Keep the HTTP status if the backend did not return JSON.
        }
        throw new Error(detail);
      }
      const data = await response.json();

      if (data.analysis) {
        setUploadStatus("Image uploaded and analyzed successfully!");
        setMessages((prev) => [
          ...prev,
          { text: "Uploaded an image for analysis.", sender: "user" },
          { text: data.analysis, sender: "assistant" },
        ]);
      }
    } catch (error) {
      console.error("Upload error:", error);
      setUploadStatus(
        error instanceof Error ? error.message : "Error uploading image."
      );
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setUploadStatus("");
    }
  };

  const handleCreateAppointment = async () => {
    if (!newAppointment.purpose.trim()) {
      alert("Please enter a purpose for the appointment");
      return;
    }
    if (!newAppointment.email.trim()) {
      alert("Please enter an email address for the appointment confirmation");
      return;
    }

    setIsLoading(true);
    setApiError(null);
    try {
      const response = await fetch(`${API_URL}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          date_time: new Date(newAppointment.date_time).toISOString(),
          purpose: newAppointment.purpose,
          email: newAppointment.email.trim(),
        }),
      });

      if (!response.ok) {
        let detail = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          if (typeof errorData.detail === "string") {
            detail = errorData.detail;
          }
        } catch {
          // Keep the HTTP status if the backend did not return JSON.
        }
        throw new Error(detail);
      }

      const result: { email_sent: boolean; notification?: string } =
        await response.json();
      await fetchAppointments();
      setNewAppointment({
        date_time: new Date(Date.now() + 30 * 60000).toISOString().slice(0, 16),
        purpose: "",
        email: "",
      });
      if (result.email_sent) {
        alert(result.notification || "Appointment created and confirmation email sent.");
      } else {
        setApiError(
          result.notification ||
            "Appointment created, but the confirmation email could not be sent."
        );
      }
    } catch (error) {
      console.error("Error creating appointment:", error);
      setApiError(
        error instanceof Error
          ? error.message
          : "Failed to create appointment."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="bg-white rounded-t-2xl shadow-lg p-6 border-b border-blue-100">
          <h1 className="text-3xl font-bold text-blue-900">
            Health Assistant 🩺
          </h1>
          <p className="text-blue-600 mt-1">
            Your personal AI healthcare companion
          </p>
        </header>

        <div className="bg-white rounded-b-2xl shadow-lg">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 px-6 py-4 text-lg font-medium transition-colors ${
                activeTab === "chat"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-600 hover:text-blue-600"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab("appointments")}
              className={`flex-1 px-6 py-4 text-lg font-medium transition-colors ${
                activeTab === "appointments"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-600 hover:text-blue-600"
              }`}
            >
              Appointments
            </button>
          </div>

          <div className="p-6">
            {apiError && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-red-700">{apiError}</p>
              </div>
            )}

            {activeTab === "chat" ? (
              <div className="space-y-6">
                <div
                  ref={chatContainerRef}
                  className="h-[400px] overflow-y-auto space-y-4 p-4 bg-gray-50 rounded-xl"
                >
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${
                        message.sender === "user"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] p-4 rounded-xl text-left leading-relaxed break-words ${
                          message.sender === "user"
                            ? "bg-blue-600 text-white"
                            : "bg-white text-gray-800 shadow-md"
                        }`}
                      >
                        {message.sender === "assistant" ? (
                          <ReactMarkdown
                            components={{
                              p: ({ ...props }) => (
                                <p className="mb-3 last:mb-0" {...props} />
                              ),
                              strong: ({ ...props }) => (
                                <strong
                                  className="font-semibold text-blue-900"
                                  {...props}
                                />
                              ),
                              ul: ({ ...props }) => (
                                <ul
                                  className="my-2 list-disc space-y-1 pl-5"
                                  {...props}
                                />
                              ),
                              ol: ({ ...props }) => (
                                <ol
                                  className="my-2 list-decimal space-y-1 pl-5"
                                  {...props}
                                />
                              ),
                              li: ({ ...props }) => (
                                <li className="pl-1" {...props} />
                              ),
                              h1: ({ ...props }) => (
                                <h1
                                  className="mb-2 mt-3 text-base font-semibold text-gray-900 first:mt-0"
                                  {...props}
                                />
                              ),
                              h2: ({ ...props }) => (
                                <h2
                                  className="mb-2 mt-3 text-base font-semibold text-gray-900 first:mt-0"
                                  {...props}
                                />
                              ),
                              h3: ({ ...props }) => (
                                <h3
                                  className="mb-1 mt-2 font-semibold text-gray-900 first:mt-0"
                                  {...props}
                                />
                              ),
                              code: ({ ...props }) => (
                                <code
                                  className="rounded bg-gray-100 px-1 py-0.5 text-[0.9em]"
                                  {...props}
                                />
                              ),
                            }}
                          >
                            {message.text}
                          </ReactMarkdown>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm">
                            {message.text}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                    placeholder={
                      isChatLoading ? "Waiting for a response..." : "Type your message..."
                    }
                    className="flex-1 px-4 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() =>
                      isRecording ? stopRecording() : startRecording()
                    }
                    className={`p-2 rounded-xl transition-colors ${
                      isRecording
                        ? "bg-red-500 hover:bg-red-600 animate-pulse"
                        : "bg-blue-600 hover:bg-blue-700"
                    } text-white`}
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleSendMessage}
                    disabled={isChatLoading || !inputMessage.trim()}
                    aria-label={isChatLoading ? "Waiting for assistant response" : "Send message"}
                    className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>

                {isRecording && (
                  <div className="flex items-center gap-2 text-red-500">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm">
                      Recording... {recordingTime}
                    </span>
                  </div>
                )}

                <div className="mt-6 p-6 bg-gray-50 rounded-xl">
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">
                    Upload Image
                  </h2>
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept="image/*"
                    className="w-full mb-4"
                  />
                  <button
                    onClick={handleFileUpload}
                    disabled={!selectedFile}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      selectedFile
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-gray-200 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    <Upload className="w-5 h-5" />
                    Upload
                  </button>
                  {uploadStatus && (
                    <p
                      className={`mt-2 text-sm ${
                        uploadStatus.includes("Error")
                          ? "text-red-600"
                          : uploadStatus.includes("success")
                          ? "text-green-600"
                          : "text-gray-600"
                      }`}
                    >
                      {uploadStatus}
                    </p>
                  )}
                  {previewUrl && (
                    <div className="mt-4">
                      <h3 className="text-lg font-semibold mb-2">Preview:</h3>
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="max-w-xs rounded-lg shadow-md"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-gray-50 p-6 rounded-xl">
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">
                    Schedule an Appointment
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        value={newAppointment.date_time}
                        onChange={(e) =>
                          setNewAppointment({
                            ...newAppointment,
                            date_time: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Purpose
                      </label>
                      <input
                        type="text"
                        value={newAppointment.purpose}
                        onChange={(e) =>
                          setNewAppointment({
                            ...newAppointment,
                            purpose: e.target.value,
                          })
                        }
                        placeholder="e.g., Annual check-up"
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Confirmation Email
                      </label>
                      <input
                        type="email"
                        value={newAppointment.email}
                        onChange={(e) =>
                          setNewAppointment({
                            ...newAppointment,
                            email: e.target.value,
                          })
                        }
                        placeholder="you@example.com"
                        required
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        The appointment confirmation will be sent to this address.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleCreateAppointment}
                    disabled={isLoading}
                    className={`mt-4 px-6 py-2 rounded-lg transition-colors ${
                      isLoading
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700"
                    } text-white`}
                  >
                    {isLoading ? "Scheduling..." : "Schedule Appointment"}
                  </button>
                </div>

                <div className="bg-gray-50 p-6 rounded-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">
                      Your Appointments
                    </h2>
                    <button
                      onClick={fetchAppointments}
                      disabled={isLoading}
                      className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                        isLoading
                          ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                      }`}
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
                      />
                      {isLoading ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                  <div className="space-y-4">
                    {isLoading ? (
                      <p className="text-center text-gray-500">
                        Loading appointments...
                      </p>
                    ) : appointments.length === 0 ? (
                      <p className="text-center text-gray-500">
                        No appointments found
                      </p>
                    ) : (
                      appointments.map((appointment) => (
                        <div
                          key={appointment.id}
                          className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium">
                                {new Date(
                                  appointment.date_time
                                ).toLocaleDateString()}{" "}
                                at{" "}
                                {new Date(
                                  appointment.date_time
                                ).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                              <p className="text-gray-600">
                                {appointment.purpose}
                              </p>
                              <p className="text-sm text-gray-500">
                                Status: {appointment.status}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setEditAppointment({
                                    id: appointment.id,
                                    date_time: appointment.date_time.slice(
                                      0,
                                      16
                                    ),
                                    purpose: appointment.purpose,
                                  });
                                  setIsModalOpen(true);
                                }}
                                className="p-2 text-blue-600 hover:text-blue-800 transition-colors"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                aria-label={`Cancel appointment for ${appointment.purpose}`}
                                title="Cancel appointment"
                                disabled={
                                  cancellingAppointmentId === appointment.id
                                }
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Are you sure you want to cancel this appointment?"
                                    )
                                  ) {
                                    void handleCancelAppointment(appointment.id);
                                  }
                                }}
                                className="p-2 text-red-600 hover:text-red-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {cancellingAppointmentId === appointment.id ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
