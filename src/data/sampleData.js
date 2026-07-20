const profiles = [
  {
    id: "barbie",
    name: "Barbie",
    age: 22,
    city: "Nairobi",
    distance: "4 km away",
    headline: "Golden hour chaser",
    bio: "Designer, soft-life believer, and always planning the next road trip with a good playlist.",
    gradientStart: "#F76B8A",
    gradientEnd: "#2D1E2F",
    interests: ["Afrobeats", "Coffee dates", "Weekend drives", "Dogs"],
    imageUrls: ["https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=900&q=80"],
    latitude: -1.2921,
    longitude: 36.8219,
  },
  {
    id: "suu",
    name: "Suu",
    age: 24,
    city: "Kampala",
    distance: "9 km away",
    headline: "Gym, glow, and good banter",
    bio: "I like people who can hold a conversation, laugh fast, and still make time for sunsets.",
    gradientStart: "#FD9E6A",
    gradientEnd: "#281515",
    interests: ["Pilates", "Photography", "Podcasts", "Brunch"],
    imageUrls: ["https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=900&q=80"],
    latitude: 0.3476,
    longitude: 32.5825,
  },
  {
    id: "musical",
    name: "Musical",
    age: 23,
    city: "Kigali",
    distance: "14 km away",
    headline: "Amapiano curator",
    bio: "If the aux reaches me, the vibe is handled. Looking for something intentional and light.",
    gradientStart: "#F2D53C",
    gradientEnd: "#3A1808",
    interests: ["Live sets", "Hiking", "Travel", "Street food"],
    imageUrls: ["https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=80"],
    latitude: -1.9441,
    longitude: 30.0619,
  },
  {
    id: "zuri",
    name: "Zuri",
    age: 26,
    city: "Mombasa",
    distance: "18 km away",
    headline: "Late-night thinker",
    bio: "Bookshops, ocean air, and quiet confidence. I want a calm person with sharp humor.",
    gradientStart: "#7FD1B9",
    gradientEnd: "#1A2336",
    interests: ["Poetry", "Beach walks", "Matcha", "Museums"],
    imageUrls: ["https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80"],
    latitude: -4.0435,
    longitude: 39.6682,
  },
];

const conversations = [
  { id: "barbie", name: "Barbie", status: "Online now", recipientId: "barbie", gradientStart: "#F76B8A", gradientEnd: "#2D1E2F" },
  { id: "musical", name: "Musical", status: "Seen 2m ago", recipientId: "musical", gradientStart: "#F2D53C", gradientEnd: "#3A1808" },
  { id: "zuri", name: "Zuri", status: "Typing recently", recipientId: "zuri", gradientStart: "#7FD1B9", gradientEnd: "#1A2336" },
];

const messagesByConversation = {
  barbie: [
    { author: "Barbie", body: "You look like you know the best coffee spots.", timestamp: "11:12", fromCurrentUser: false },
    { author: "You", body: "Only if you can handle strong opinions and stronger espresso.", timestamp: "11:14", fromCurrentUser: true },
    { author: "Barbie", body: "That sounds like a challenge. I like challenges.", timestamp: "11:15", fromCurrentUser: false },
  ],
  musical: [
    { author: "Musical", body: "If you had the aux right now, what track opens the drive?", timestamp: "10:01", fromCurrentUser: false },
    { author: "You", body: "Amapiano first, then a clean RnB switch after sunset.", timestamp: "10:03", fromCurrentUser: true },
    { author: "Musical", body: "That is suspiciously correct.", timestamp: "10:04", fromCurrentUser: false },
  ],
  zuri: [
    { author: "Zuri", body: "I need a bookstore recommendation that also has good lighting.", timestamp: "Yesterday", fromCurrentUser: false },
    { author: "You", body: "Quiet corners or dramatic architecture?", timestamp: "Yesterday", fromCurrentUser: true },
  ],
};

module.exports = {
  profiles,
  conversations,
  messagesByConversation,
};
