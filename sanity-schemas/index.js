// This file goes in your Sanity Studio project's schema folder,
// and tells Sanity about all 4 content types.
import journalArticle from './journalArticle'
import homePage from './homePage'
import housePage from './housePage'
import productContent from './productContent'

export const schemaTypes = [journalArticle, homePage, housePage, productContent]
