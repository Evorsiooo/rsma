import { Bd, Box } from "./site/parts";

interface Section {
  title: string;
  lines: string[];
}

const UPDATED = "8 November 2026";
const DISCORD_URL = "https://discord.gg/29TEDUnRR7";
const ROBLOX_SECURITY_URL = "https://www.roblox.com/my/account#!/security";
const ROBLOX_TOS_URL = "https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use";
const ROBLOX_COMMUNITY_URL = "https://en.help.roblox.com/hc/en-us/articles/203313410-Roblox-Community-Standards";
const ROBLOX_GROUP_URL = "https://www.roblox.com/communities/33125027/Ro-State-Motorsport-Association#!/about";

const TERMS: Section[] = [
  {
    title: "1. Overview and Agreement",
    lines: [
      "Flagman is the official race timing, race control, and event management platform operated by the Ro-State Motorsport Association (\"RSMA\", \"we\", \"us\", or \"our\").",
      "By accessing or using Flagman (the \"Service\") or signing in with your Roblox account, you agree to be bound by these Terms of Service. If you do not agree to these Terms, you may not access or use the Service.",
    ],
  },
  {
    title: "2. Eligibility and Age Requirements",
    lines: [
      "You must be at least 13 years of age, or the age of digital consent in your jurisdiction, to use the Service. If you are under the age of majority in your jurisdiction, you may only use the Service with the consent and supervision of a parent or legal guardian.",
      "By using the Service, you represent and warrant that you meet these eligibility requirements.",
    ],
  },
  {
    title: "3. Roblox Account and OAuth 2.0 Integration",
    lines: [
      "Flagman uses Roblox OAuth 2.0 to provide secure sign-in and authenticate drivers, team personnel, and race officials.",
      "When signing in via Roblox, we request access only to your public profile information (the openid and profile scopes), specifically: your Roblox User ID, username, and display name.",
      "We never request, access, or store your Roblox password, payment details, Robux balance, or private inventory.",
      `You may revoke Flagman's access to your Roblox account at any time in your Roblox Account Settings under Security > Authorized Applications (${ROBLOX_SECURITY_URL}).`,
      `Your use of Roblox accounts and services is governed at all times by the Roblox Terms of Use (${ROBLOX_TOS_URL}) and the Roblox Community Standards (${ROBLOX_COMMUNITY_URL}).`,
    ],
  },
  {
    title: "4. Code of Conduct and Acceptable Use",
    lines: [
      "The Service is provided to support fair, competitive, and respectful motorsport time-trials, rallies, and races.",
      "You agree that you will not:",
      "- Manipulate, tamper with, or falsify timing telemetry, stopwatches, or finish-line records.",
      "- Attempt to access or modify administrative, steward, or team tools for which you have not been granted permission by an administrator.",
      "- Send abusive, harassing, defamatory, discriminatory, obscene, or unlawful messages over team radio, driver radio, or chat channels.",
      "- Interfere with, disrupt, overload, or compromise the integrity, security, or availability of the Service or its underlying infrastructure.",
      "- Impersonate any Roblox user, driver, team personnel, or RSMA steward.",
    ],
  },
  {
    title: "5. Event Rules and Steward Authority",
    lines: [
      "Event entry, race control flags, start releases, cadence, penalty assessments (including track limits, jump starts, and checkpoint penalties), and final classifications are governed by RSMA event regulations.",
      "All decisions made by event stewards regarding on-track flags, penalties, timing adjustments, and results are final for the respective event.",
      "RSMA administrators reserve the right to disqualify, remove, or ban any driver or team from events or the platform for unsportsmanlike conduct or violations of these Terms.",
    ],
  },
  {
    title: "6. Intellectual Property and Roblox Non-Affiliation",
    lines: [
      "All software, designs, layouts, user interface components, and graphics of Flagman are the property of RSMA or its licensors.",
      "Non-Affiliation Disclaimer: Flagman and the Ro-State Motorsport Association are independent community-operated services. This site is not affiliated with, sponsored by, endorsed by, or associated with Roblox Corporation.",
      "\"ROBLOX\" and the Roblox logo are registered trademarks of Roblox Corporation.",
    ],
  },
  {
    title: "7. Disclaimers and \"As Is\" Provision",
    lines: [
      "The Service is provided on an \"AS IS\" and \"AS AVAILABLE\" basis without warranties of any kind, whether express, implied, statutory, or otherwise.",
      "We do not warrant that the Service will be uninterrupted, error-free, timely, secure, or free from network latency, packet loss, or server disruptions that may impact live timing.",
    ],
  },
  {
    title: "8. Limitation of Liability",
    lines: [
      "To the maximum extent permitted by applicable law, RSMA, its contributors, and administrators shall not be liable for any direct, indirect, incidental, special, consequential, or exemplary damages resulting from your use of or inability to use the Service, including but not limited to loss of event results, data, or technical interruptions.",
    ],
  },
  {
    title: "9. Modifications to Terms",
    lines: [
      "We may revise and update these Terms from time to time. The date of the latest update is displayed at the top of this page. Your continued use of the Service following any modifications indicates your acceptance of the updated Terms.",
    ],
  },
  {
    title: "10. Termination",
    lines: [
      "We reserve the right, without prior notice or liability, to suspend or terminate your access to the Service or revoke staff/team roles at our sole discretion, including for conduct that violates these Terms or harms the community.",
    ],
  },
  {
    title: "11. Contact and Inquiries",
    lines: [
      `For questions, disputes, or support regarding these Terms, please contact RSMA staff on our official Discord server (${DISCORD_URL}) or through the RSMA Roblox community group (${ROBLOX_GROUP_URL}).`,
    ],
  },
];

const PRIVACY: Section[] = [
  {
    title: "1. Information We Collect",
    lines: [
      "Roblox Profile Information: When you sign in using Roblox OAuth 2.0, we request the 'openid' and 'profile' scopes to retrieve your Roblox User ID (sub), username, and display name. We never request, access, or store your Roblox password, payment details, billing address, Robux balance, or private inventory.",
      "Competition and Event Data: During races and time-trials, we store competition metrics including car numbers, vehicle plates, assigned running order, raw stage times, lap records, steward penalties, team affiliations, and event registrations.",
      "Communications and Chat: In-session team radio messages, driver responses, steward notes, and race control announcements sent during an active event are processed and stored to maintain the live event log.",
      "Team Management: For team-based sessions, we store roster allocations, team names, car assignments, and sporting roles (Principal, Sporting Director, Race Engineer, Driver).",
    ],
  },
  {
    title: "2. How We Use Information (Purpose and Legal Basis)",
    lines: [
      "Authentication and Authorization: To verify your Roblox identity, manage your signed-in session, and confirm your steward, team, or driver permissions.",
      "Live Timing and Event Management: To calculate split times, maintain accurate stage rankings, coordinate pit windows, and display live leaderboards.",
      "Race Communications: To deliver real-time flag changes, steward radio notices, driver pop-out text-to-speech audio, and team tactical queries.",
      "Sporting Integrity: To maintain an immutable audit log of steward decisions, penalties, and time corrections for fair competition.",
    ],
  },
  {
    title: "3. On-Device Voice and AI Audio Processing",
    lines: [
      "Local Browser Execution: Flagman offers an optional AI driver radio voice synthesizer powered by kokoro-js and WebGPU / WebAssembly.",
      "Zero Cloud Voice Transmission: All neural model weights run entirely within your local web browser on your personal device. Spoken radio lines and text prompts are never uploaded, recorded, transmitted to external AI servers, or used for model training.",
    ],
  },
  {
    title: "4. Cookies, Session Tokens, and Local Storage",
    lines: [
      "flagman_session: A secure, HTTP-only, SameSite=Lax cookie containing an HMAC-SHA256 cryptographically signed session token. It expires automatically after 30 days and contains no personal information other than your signed user ID.",
      "flagman_oauth: A temporary, secure HTTP-only cookie with a 10-minute lifetime used solely for PKCE verifier state matching and anti-CSRF protection during the Roblox OAuth login handshake.",
      "Local Storage: Your web browser's local storage is used exclusively to remember client-side preferences (such as audio volume, preferred voice engine, and display settings). These values remain on your device and are never transmitted to our servers.",
      "No Third-Party Trackers: We do not use third-party analytics (e.g. Google Analytics), tracking pixels, advertising networks, or marketing cookies.",
    ],
  },
  {
    title: "5. Information Sharing and Third-Party Subprocessors",
    lines: [
      "Public Leaderboards: Race results, driver display names, vehicle plates, finish times, and public race control radio are visible to anyone viewing the public event pages.",
      "Confidential Communications: Private team radio channels, driver inquiry notes, and internal steward logs are strictly restricted to authenticated race officials and verified members of that specific team.",
      "No Sale or Rental of Data: We do not sell, rent, lease, monetize, or share your personal data with third parties or data brokers under any circumstances.",
      "Infrastructure Subprocessors:",
      "- Cloudflare, Inc.: Serverless edge computing (Cloudflare Workers) and distributed encrypted database storage (Cloudflare D1) located globally with enterprise DDoS protection.",
      "- Roblox Corporation: Provides user identity verification through Roblox OAuth 2.0.",
    ],
  },
  {
    title: "6. Data Retention",
    lines: [
      "Session Tokens: Active session cookies automatically expire and become invalid after 30 days of inactivity.",
      "Historical Competition Archives: Race results, stage times, driver names, and tournament standings are retained indefinitely as historical competition archives for RSMA championship records.",
      "Account Association: Your Roblox ID and assigned roles are retained while your account remains active or until you request account deletion.",
    ],
  },
  {
    title: "7. Your Rights and Data Deletion (GDPR, CCPA, and Roblox RTBF)",
    lines: [
      "Right to Erasure / Deletion: You have the right to request the complete deletion of your account and the removal or anonymization of your personal data from Flagman. To submit a deletion request, contact staff on Discord or through the Roblox community group. Requests are processed within 30 days.",
      `Revoking Roblox Access: You can immediately disconnect Flagman from your Roblox account at any time directly through your Roblox Account Settings under Security > Authorized Applications (${ROBLOX_SECURITY_URL}). Revoking authorization immediately prevents Flagman from accessing your Roblox account.`,
      "Right to Access: You may request a copy of the personal data associated with your Roblox user ID.",
      "Right to Rectification: Display names and usernames are automatically updated from Roblox upon each login.",
      "Non-Discrimination: We will never discriminate, restrict features, or degrade your service for exercising any of your privacy rights.",
    ],
  },
  {
    title: "8. Children's Privacy (COPPA and Roblox Platform Compliance)",
    lines: [
      "Flagman is designed in compliance with the Roblox Developer Policies, the Children's Online Privacy Protection Act (COPPA), and global child safety standards.",
      "We do not knowingly collect personal information directly from children under 13 beyond the minimal public Roblox profile credentials required for gameplay authentication.",
      "We never request or collect real names, home addresses, phone numbers, or external contact information from any user.",
      `If a parent or legal guardian discovers that their child has provided personal information without consent, please contact us on Discord (${DISCORD_URL}) and we will promptly remove the data.`,
    ],
  },
  {
    title: "9. Data Security Safeguards",
    lines: [
      "All web traffic between your browser and Flagman is encrypted in transit using modern Transport Layer Security (TLS 1.3 / HTTPS).",
      "Authentication cookies are protected with cryptographic HMAC-SHA256 signatures, preventing tampering or session spoofing.",
      "Role-based access control (RBAC) ensures only authorized stewards and verified team members can view sensitive timing controls or private team channels.",
    ],
  },
  {
    title: "10. Policy Updates",
    lines: [
      "We may update this Privacy Policy from time to time to reflect changes in our platform or legal requirements. The 'Last Updated' date at the top of this document indicates when changes were made. Continued use of the Service constitutes acceptance of the revised policy.",
    ],
  },
  {
    title: "11. Contact and Privacy Inquiries",
    lines: [
      `For any privacy inquiries, data deletion requests, or questions regarding this Privacy Policy, please reach out to the RSMA administration on our official Discord server (${DISCORD_URL}) or our Roblox community group (${ROBLOX_GROUP_URL}).`,
    ],
  },
];

const URL_REGEX = /(https?:\/\/[^\s)]+)/g;

function renderLine(text: string) {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) =>
        URL_REGEX.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            style={{ wordBreak: "break-all" }}
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function LegalPage({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <>
      <Box title={title}>
        <Bd><div className="note">Last updated {UPDATED}</div></Bd>
      </Box>
      {sections.map((s) => (
        <Box title={s.title} key={s.title}>
          <Bd>
            {s.lines.map((l, i) => (
              <p key={i} style={{ marginTop: i ? 6 : 0 }}>
                {renderLine(l)}
              </p>
            ))}
          </Bd>
        </Box>
      ))}
    </>
  );
}

export const Terms = () => <LegalPage title="Terms of service" sections={TERMS} />;
export const Privacy = () => <LegalPage title="Privacy policy" sections={PRIVACY} />;
