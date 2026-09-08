import nodemailer from 'nodemailer'

// Same "frontend base URL" concept auth.routes.js reuses for confirm/reset
// links -- needed here too, to build absolute URLs to the site's own logo/
// mascot images (email clients can't load a relative ./assets/... path).
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

let transporter

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    })
  }
  return transporter
}

// Table-based layout + inline styles throughout -- Gmail/Outlook strip
// <style> blocks and flexbox/grid, so this is the only markup that renders
// consistently the same way across mail clients. Reuses the site's actual
// logo/mascot images and the dashed "ticket-stub" divider + gradient-button
// look already established by the membership-card UI in SignupPage.jsx/
// LoginPage.jsx, instead of an unrelated generic template. Shared by every
// transactional email this app sends -- see verificationEmailHtml/
// passwordResetEmailHtml below for the callers.
function emailCardHtml({ heading, bodyText, buttonText, link, footerText }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F8E9;padding:40px 16px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 16px 32px rgba(46,125,50,0.12);">
      <tr>
        <td align="center" style="padding:30px 32px 20px;">
          <img src="${FRONTEND_ORIGIN}/assets/dino-logo-full.png" alt="Dino" height="32" style="height:32px;width:auto;display:block;margin:0 auto 6px;border:0;">
          <div style="color:#8a938c;font-size:11.5px;">ผู้ช่วยนำเที่ยวขอนแก่น</div>
        </td>
      </tr>
      <tr><td style="padding:0 32px;"><div style="border-top:1.5px dashed #DCD8C6;"></div></td></tr>
      <tr>
        <td align="center" style="padding:26px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
            <tr>
              <td width="64" height="64" align="center" valign="middle" style="width:64px;height:64px;border-radius:50%;background:#2E7D32;background:linear-gradient(135deg,#66BB6A,#388E3C);">
                <img src="${FRONTEND_ORIGIN}/assets/chatbot-icon.png" alt="" width="38" height="38" style="width:38px;height:38px;border:0;vertical-align:middle;">
              </td>
            </tr>
          </table>
          <div style="color:#1B5E20;font-size:19px;font-weight:800;text-align:center;margin-bottom:12px;">${heading}</div>
          <p style="color:#4a544d;font-size:14px;line-height:1.7;text-align:center;margin:0 0 24px;">
            ${bodyText}
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr>
              <td style="border-radius:24px;background:#2E7D32;background:linear-gradient(135deg,#66BB6A,#388E3C);">
                <a href="${link}" style="display:inline-block;padding:13px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:24px;">${buttonText}</a>
              </td>
            </tr>
          </table>
          <p style="color:#8a938c;font-size:12px;line-height:1.6;text-align:center;margin:0 0 24px;word-break:break-all;">
            หากปุ่มด้านบนกดไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>
            <a href="${link}" style="color:#2E7D32;">${link}</a>
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px 28px;border-top:1.5px dashed #DCD8C6;">
          <p style="color:#a9b3ac;font-size:11.5px;line-height:1.6;text-align:center;margin:16px 0 0;">
            ${footerText}
          </p>
          <p style="color:#c2cac4;font-size:10.5px;line-height:1.6;text-align:center;margin:14px 0 0;">
            ศูนย์ข้อมูลท่องเที่ยวขอนแก่น<br>
            การท่องเที่ยวแห่งประเทศไทย (ททท.) สำนักงานขอนแก่น
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`
}

function verificationEmailHtml(link) {
  return emailCardHtml({
    heading: 'ยืนยันอีเมลของคุณ',
    bodyText: 'ขอบคุณที่สมัครสมาชิก Dino กรุณากดปุ่มด้านล่างเพื่อยืนยันอีเมลนี้และเริ่มใช้งานบัญชีของคุณ',
    buttonText: 'ยืนยันอีเมล',
    link,
    footerText: 'ลิงก์นี้จะหมดอายุใน 24 ชั่วโมง หากคุณไม่ได้เป็นผู้สมัครสมาชิก สามารถละเว้นอีเมลฉบับนี้ได้เลย',
  })
}

function passwordResetEmailHtml(link) {
  return emailCardHtml({
    heading: 'รีเซ็ตรหัสผ่านของคุณ',
    bodyText: 'เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชี Dino ของคุณ กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่',
    buttonText: 'ตั้งรหัสผ่านใหม่',
    link,
    footerText: 'ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง หากคุณไม่ได้เป็นผู้ขอรีเซ็ตรหัสผ่าน สามารถละเว้นอีเมลนี้ได้เลย รหัสผ่านเดิมของคุณจะไม่ถูกเปลี่ยนแปลง',
  })
}

export async function sendVerificationEmail(to, link) {
  await getTransporter().sendMail({
    from: `"Dino" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'ยืนยันอีเมลของคุณ - Dino',
    html: verificationEmailHtml(link),
    text: `ยืนยันอีเมลของคุณ - Dino\n\nกรุณาเปิดลิงก์นี้เพื่อยืนยันบัญชี Dino ของคุณ:\n${link}\n\nลิงก์นี้จะหมดอายุใน 24 ชั่วโมง หากคุณไม่ได้เป็นผู้สมัครสมาชิก สามารถละเว้นอีเมลฉบับนี้ได้เลย\n\n--\nศูนย์ข้อมูลท่องเที่ยวขอนแก่น\nการท่องเที่ยวแห่งประเทศไทย (ททท.) สำนักงานขอนแก่น`,
  })
}

export async function sendPasswordResetEmail(to, link) {
  await getTransporter().sendMail({
    from: `"Dino" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'รีเซ็ตรหัสผ่านของคุณ - Dino',
    html: passwordResetEmailHtml(link),
    text: `รีเซ็ตรหัสผ่านของคุณ - Dino\n\nกรุณาเปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่:\n${link}\n\nลิงก์นี้จะหมดอายุใน 1 ชั่วโมง หากคุณไม่ได้เป็นผู้ขอรีเซ็ตรหัสผ่าน สามารถละเว้นอีเมลนี้ได้เลย\n\n--\nศูนย์ข้อมูลท่องเที่ยวขอนแก่น\nการท่องเที่ยวแห่งประเทศไทย (ททท.) สำนักงานขอนแก่น`,
  })
}
