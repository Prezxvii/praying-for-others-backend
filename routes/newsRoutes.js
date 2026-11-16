const express = require('express');
const router = express.Router();
const NewsArticle = require('../models/NewsArticle');
const axios = require('axios');

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const TRUSTED_DOMAINS = 'christianitytoday.com,wng.org,opendoorsusa.org,persecution.com';

// GET: Approved articles for the home feed (up to 20)
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const query = { status: 'approved' };
    if (category && category !== 'All') query.category = category;

    const articles = await NewsArticle.find(query)
      .sort({ approvedAt: -1, publishedAt: -1 })
      .limit(20);

    // If admin hasn't curated enough articles yet fall back to NewsAPI
    if (articles.length < 5) {
      const q = category && category !== 'All'
        ? `${category.toLowerCase()}+christians`
        : 'christian+persecution';

      let response = await axios.get(
        `https://newsapi.org/v2/everything?q=${q}&domains=${TRUSTED_DOMAINS}&sortBy=publishedAt&pageSize=20&language=en&apiKey=${NEWS_API_KEY}`
      ).catch(() => null);

      if (!response?.data?.articles?.length) {
        response = await axios.get(
          `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=20&language=en&apiKey=${NEWS_API_KEY}`
        ).catch(() => null);
      }

      const fallback = (response?.data?.articles || []).map(a => ({
        _id: a.url,
        title: a.title,
        description: a.description,
        url: a.url,
        urlToImage: a.urlToImage,
        sourceName: a.source?.name,
        publishedAt: a.publishedAt,
        adminNote: '',
        isFallback: true,
      }));

      return res.json([...articles, ...fallback].slice(0, 20));
    }

    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;