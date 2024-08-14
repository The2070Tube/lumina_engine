import express from 'express';
import path from 'path';
import cors from 'cors';
import fetch from 'node-fetch';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const MODEL_NAME = "gemini-1.5-pro";
const API_KEY = process.env.API_KEY;
const WEATHER_API_KEY = 'db8acffcc78bcd71d8efd56c0faa0344';
const WEATHER_API_BASE = 'https://api.openweathermap.org/data/2.5/';

async function fetchWeather(city) {
  if (!city || city.trim().length === 0 || city.trim().toLowerCase() === "hello") {
    return null;
  }

  try {
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${WEATHER_API_KEY}`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();

    if (geoData.length > 0) {
      const lat = geoData[0].lat;
      const lon = geoData[0].lon;

      const weatherUrl = `${WEATHER_API_BASE}weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;
      const airPollutionUrl = `${WEATHER_API_BASE}air_pollution?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}`;

      const [weatherResponse, airPollutionResponse] = await Promise.all([
        fetch(weatherUrl),
        fetch(airPollutionUrl)
      ]);

      const weatherData = await weatherResponse.json();
      const airPollutionData = await airPollutionResponse.json();

      return { weatherData, airPollutionData };
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return null;
  }
}

async function fetchDrugInfo(drugName) {
  try {
    const url = `https://api.fda.gov/drug/label.json?search=openfda.brand_name:${encodeURIComponent(drugName)}&limit=1`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results[0];
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching drug information:', error);
    return null;
  }
}

async function runChat(userInput, chatHistory) {
  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 1500,
  };

  const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    // ... other safety settings
  ];

  let weatherInfo = null;
  let drugInfo = null;

  // Check if the previous message was asking for the city
  if (chatHistory.length > 0 && 
      chatHistory[chatHistory.length - 1].role === "model" &&
      chatHistory[chatHistory.length - 1].parts[0].text.toLowerCase().includes("what city")) {
    weatherInfo = await fetchWeather(userInput);
  }

  // Check if the user input contains a drug name
  const drugName = userInput.match(/\b(?:drug|medication)\s+(\w+)\b/i);
  if (drugName) {
    drugInfo = await fetchDrugInfo(drugName[1]);
  }

  chatHistory.push({
    role: "user",
    parts: [{ text: userInput }]
  });

  const chat = model.startChat({
    generationConfig,
    safetySettings,
    history: chatHistory,
  });

  const result = await chat.sendMessage(userInput);
  let response = result.response.text();

  if (weatherInfo) {
    const weatherData = weatherInfo.weatherData;
    const airPollutionData = weatherInfo.airPollutionData;

    let weatherDetails = `\n\nThe current weather in ${userInput} is as follows:\n`;
    weatherDetails += `- Description: ${weatherData.weather[0].description}\n`;
    weatherDetails += `- Temperature: ${weatherData.main.temp}°C (${((weatherData.main.temp * 9/5) + 32).toFixed(1)}°F)\n`;
    weatherDetails += `- Humidity: ${weatherData.main.humidity}%\n`;
    weatherDetails += `- Wind Speed: ${weatherData.wind.speed} m/s\n\n`;

    weatherDetails += `Air Pollution Levels:\n`;
    weatherDetails += `- AQI: ${airPollutionData.list[0].main.aqi} (1 = Good, 5 = Hazardous)\n`;
    weatherDetails += `- PM2.5: ${airPollutionData.list[0].components.pm2_5} µg/m³\n`;
    weatherDetails += `- PM10: ${airPollutionData.list[0].components.pm10} µg/m³\n`;

    response += weatherDetails;
  }

  if (drugInfo) {
    const brandName = drugInfo.openfda.brand_name ? drugInfo.openfda.brand_name.join(', ') : 'N/A';
    const genericName = drugInfo.openfda.generic_name ? drugInfo.openfda.generic_name.join(', ') : 'N/A';
    const purpose = drugInfo.purpose ? drugInfo.purpose.join(' ') : 'N/A';
    const usage = drugInfo.indications_and_usage ? drugInfo.indications_and_usage.join(' ') : 'N/A';

    let drugDetails = `\n\nDrug Information for ${brandName}:\n`;
    drugDetails += `- Generic Name: ${genericName}\n`;
    drugDetails += `- Purpose: ${purpose}\n`;
    drugDetails += `- Indications and Usage: ${usage}\n`;

    response += drugDetails;
  }

  chatHistory.push({
    role: "model",
    parts: [{ text: response }]
  });

  return response;
}

const chatHistory = [
  {
    role: "user",
    parts: [{ text: "Sam, you are a highly confident and friendly AI Chatbot developed by EnviroGen, specifically designed to engage in medical-related conversations with users. Your primary objective is to diagnose users based on the symptoms they describe and to provide clear, actionable medical advice. When a user initiates a conversation, greet them warmly and make them feel comfortable by asking about their day or how they're feeling. As the conversation progresses, your first task is to gather necessary information by asking the user for the name of the city they are currently in, emphasizing that a simple one-word answer is sufficient. Once you receive this information, transition into the next phase where you ask the user to list any symptoms they are experiencing, encouraging them to provide as much detail as possible, including both major and minor symptoms. After the user has shared their symptoms, your next step is to diagnose their condition. This diagnosis should be delivered as a single, clear word, representing the illness or condition you believe the user may have, based on the information they provided. This one-word diagnosis should stand alone in its own sentence to ensure clarity and easy integration with any subsequent APIs or functions. Immediately following this one-word diagnosis, you must provide a detailed explanation that justifies your assessment, explaining how the user's symptoms correlate with the diagnosis you've provided. Engage in further conversation with the user, offering advice on potential treatments, lifestyle adjustments, or the next steps they should consider. Always speak with confidence, as if you are a knowledgeable and reliable medical assistant, avoiding any language that might suggest limitations in your ability to give medical advice. Your role is to provide guidance and support, helping the user manage their health concerns, and keeping the conversation focused on medical topics. If the user has follow-up questions or requests more details, continue to provide information confidently, suggesting over-the-counter remedies, home care tips, or advising when it might be appropriate to seek professional medical attention. Your overall tone should remain reassuring and supportive, ensuring that the user feels heard and well-advised throughout the interaction. Always circle back to health and medical topics. Don't give weather data unless user says their city and in any message after you give."}]           
  },
  {
    role: "user",
    parts: [{ text: "Remember. Once the user gives their city name and you give back the weather data only at that specific instance, I want you to add on to that. based on the data you have for the weather, I want you to give medical/health advisory if needed based on air quality, hazards, or forecast. DO NOT give weather information until after the user gives you the name of the city. until that, carry on the normal conversation until you ask them the city like i told you before. Once you give the weather data after the user gives the city, never fetch or tell the user weather data again as the conversations carry on. strictly important. dont try to fetch data until after you've asked the user about the city. stop fetching weather data after you already given weather data to the city. do not say unable to fetch weather data or anything like that until you've asked the user the city they are from. if the user is simply greeting, don't fetch weather and dont say the error message."}]
  },
  {
    role: "user",
    parts: [{ text: "I want you to follow something very strictly. Only fetch weather data if the user sends the name of a real city based on what you know. If the user does not give the name of a real city, do not fetch weather data, do not display it, do not give an error or unable message, and do not write weather information as the output/reply to the user's message. Only say the weather data, and ONLY IF the user says the name of a real city."}]
  },
  {
    role: "user",
    parts: [{ text: "If user does not give the name of a real city, strictly you must not include the error message 'Unable to retrieve weather data for (blank). Please try another city'. Only display this message if the user is trying to give you the name of the city only AFTER YOU've asked the user. Never say the error message within your output after giving weather details based on an actual city name or before asking about the city."}]
  },
  {
    role: "model",
    parts: [{ text: "Hello! Welcome to EnviroGen. My name is Sam. What's your name?"}]
  }
];

app.get('/', (req, res) => {
  res.sendFile(path.join(path.resolve(), 'public', 'index.html'));
});

app.post('/chat', async (req, res) => {
  try {
    const userInput = req.body?.userInput;
    console.log('incoming /chat req', userInput);
    if (!userInput) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const response = await runChat(userInput, chatHistory);
    res.json({ response });
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});