# 🌍 SpotiFree V2 — מדריך העלאה לשרת חיצוני (Cloud Deployment Guide)

מדריך זה מסביר כיצד להעלות את SpotiFree V2 לשרת ענן חיצוני חינמי (Vercel / Render / Netlify / Docker) כך שהאפליקציה תהיה נגישה מכל דפדפן בטלפון הנייד (במחשב, בגלישה סלולרית 4G/5G) **ותמשיך לנגן ברקע ברציפות גם כשהמסך כבוי!**

---

## ⚡ אפשרות 1: העלאה מהירה ב-1 בלחיצה ל-Vercel (מומלץ ביותר ⭐)
Vercel מספקת אחסון ענן חינמי, חיבור HTTPS מאובטח, ותמיכה מלאה בפונקציית ה-CORS Proxy המובנית שהכנו.

1. היכנס ל-[Vercel.com](https://vercel.com) והתחבר.
2. לחץ על **Add New -> Project**.
3. יבא את תיקיית הפרויקט `spotifree-v2` (או חבר לחשבון ה-GitHub שלך).
4. הקובץ `vercel.json` שנוצר בפרויקט יגדיר אוטומטית את כל נתיבי ה-Proxy.
5. לחץ **Deploy** — תוך דקה תקבל כתובת אתר ציבורית (לדוגמה: `https://spotifree.vercel.app`).
6. פתח את הקישור מהטלפון, לחץ על **"הוסף למסך הבית" (Add to Home Screen)** — והאפליקציה תפעל כאפליקציית PWA מלאה ברקע!

---

## 🐋 אפשרות 2: העלאה ב-Docker / Render
יצרנו עבורך גם קובץ `Dockerfile` ו-`render.yaml` להרצה ישירה בכל שרת ענן התומך ב-Docker.

להרצה מקומית ב-Docker:
```bash
docker build -t spotifree-v2 .
docker run -p 8080:80 spotifree-v2
```

---

## 📱 אפשרות 3: התקנה ישירה כאפליקציית אנדרואיד (APK)
אם אינך רוצה להשתמש בדפדפן, קובץ ה-APK העצמאי מוכן בתיקיית השורש:
`C:\Users\elyas\.gemini\antigravity\scratch\spotifree-v2\SpotiFree-v2.apk`

התקן אותו בטלפון והוא יפעל עם **Android Foreground Service** המאפשר ניגון רציף ברקע במסך כבוי ללא תלות באף שרת.
