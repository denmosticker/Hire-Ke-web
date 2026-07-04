// src/pages/UserDashboard.jsx
import "./UserDashboard.css";

const opportunities = [
  ["Cybersecurity Intern", "Safaricom PLC", "Nairobi, Kenya", "Internship", "89% Match"],
  ["Data Analyst", "Andela", "Remote (Africa)", "Full-time", "84% Match"],
  ["Government Procurement Tender", "KeNHA", "Kenya", "Tender", "78% Match"],
  ["Chevening Scholarship 2025", "Commonwealth Office", "UK Funded", "Scholarship", "91% Match"],
  ["UI/UX Design Bootcamp", "Zindua School", "Nairobi, Kenya", "Training", "81% Match"],
];

const newOpportunities = [
  ["Junior Software Engineer", "M-KOPA", "Nairobi, Kenya", "Full-time"],
  ["Research Fellowship 2025", "APHRC", "Nairobi, Kenya", "Fellowship"],
  ["Youth Innovation Grant", "Mastercard Foundation", "Africa", "Grant"],
  ["Remote Support Agent", "RemoteWorkForce", "Remote", "Remote"],
  ["AI & Data Science Training", "ALX Africa", "Online", "Training"],
];

export default function UserDashboard() {
  return (
    <div className="hk-dashboard">
      <aside className="hk-sidebar">
        <div className="hk-logo">
          <img src="/hireke-logo.png" alt="HireKe logo" />
          <p>Never miss your next opportunity.</p>
        </div>

        <nav>
          {[
            "Dashboard",
            "Opportunities",
            "Saved",
            "Applications",
            "Alerts",
            "Profile Builder",
            "AI Assistant",
            "CV & Documents",
            "Analytics",
            "Premium",
            "Settings",
            "Help & Support",
            "Logout",
          ].map((item, index) => (
            <button key={item} className={index === 0 ? "active" : ""}>
              <span>{getIcon(item)}</span>
              {item}
              {item === "Profile Builder" && <small>80%</small>}
              {item === "Premium" && <small className="new">New</small>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="hk-main">
        <header className="hk-topbar">
          <div className="search-box">
            ðŸ”
            <input placeholder="Search opportunities, companies, or keywords..." />
          </div>

          <div className="top-actions">
            <button>â˜€</button>
            <button className="bell">ðŸ”” <span>3</span></button>
            <div className="user-chip">
              <img src="https://i.pravatar.cc/80?img=12" alt="User" />
              <div>
                <strong>Brian Otieno</strong>
                <p>Student</p>
              </div>
              âŒ„
            </div>
          </div>
        </header>

        <section className="welcome-row">
          <div>
            <h2>Good morning, Brian! ðŸ‘‹</h2>
            <p>Here are opportunities picked for you today.</p>
          </div>
          <button className="outline-btn">Customize Dashboard âŒ„</button>
        </section>

        <section className="top-grid">
          <div className="profile-strength dark-card">
            <h4>Profile Strength</h4>
            <div className="circle">80%</div>
            <div>
              <h3>Very Good</h3>
              <p>Complete your profile to get better matches.</p>
            </div>
            <button>Improve Profile</button>
          </div>

          <StatCard title="AI Match Score (Avg)" value="76%" note="â†‘ 12% this week" chart />
          <StatCard title="Applications" value="12" note="Total Submitted" link="View all applications" />
          <StatCard title="Saved Opportunities" value="28" note="Saved for later" link="View saved" />
          <StatCard title="Alerts On" value="15" note="Active alerts" link="Manage alerts" />

          <div className="ai-card">
            <h3>âœ¨ AI Career Assistant</h3>
            <p>Hi Brian! I can help you:</p>
            <ul>
              <li>Find suitable opportunities</li>
              <li>Improve your profile</li>
              <li>Write CVs & Cover Letters</li>
              <li>Prepare for interviews</li>
              <li>Understand requirements</li>
            </ul>
            <button>Chat with AI Assistant</button>
          </div>
        </section>

        <section className="content-grid">
          <DashboardCard title="Recommended for You">
            {opportunities.map((item) => (
              <OpportunityRow key={item[0]} data={item} showMatch />
            ))}
          </DashboardCard>

          <DashboardCard title="New Opportunities" tabs={["New Opportunities", "Trending", "Expiring Soon"]}>
            {newOpportunities.map((item) => (
              <OpportunityRow key={item[0]} data={item} />
            ))}
          </DashboardCard>

          <DashboardCard title="Recent Alerts" small>
            {[
              "New scholarship matching your profile",
              "Software engineering job posted",
              "Tender closing in 7 days",
              "New grant opportunity available",
              "UI/UX training you might like",
            ].map((alert, i) => (
              <div className="alert-row" key={alert}>
                <span>ðŸ””</span>
                <p>{alert}</p>
                <small>{i + 1}h ago</small>
              </div>
            ))}
          </DashboardCard>

          <DashboardCard title="Top Categories" small>
            <div className="category-grid">
              <span>Jobs <b>1,245</b></span>
              <span>Scholarships <b>532</b></span>
              <span>Internships <b>842</b></span>
              <span>Tenders <b>215</b></span>
              <span>Grants <b>324</b></span>
              <span>Remote Jobs <b>624</b></span>
            </div>
          </DashboardCard>
        </section>

        <section className="bottom-grid">
          <DashboardCard title="Your Activity">
            {[
              "Applied to Data Analyst at Andela",
              "Saved Cybersecurity Intern at Safaricom",
              "Generated CV - Software Engineer",
              "Updated profile information",
            ].map((x) => (
              <div className="simple-row" key={x}>âœ“ {x}</div>
            ))}
          </DashboardCard>

          <DashboardCard title="Application Analytics">
            <div className="analytics">
              <span><b>8</b> Applications</span>
              <span><b>3</b> Responses</span>
              <span><b>1</b> Interviews</span>
              <span><b>0</b> Offers</span>
            </div>
            <div className="fake-chart"></div>
          </DashboardCard>

          <DashboardCard title="Profile Tips">
            {[
              "Add more skills to improve matches",
              "Upload your CV for better recommendations",
              "Complete your education details",
              "Add your work experience",
            ].map((x) => (
              <div className="tip-row" key={x}>âœ… {x} â€º</div>
            ))}
          </DashboardCard>
        </section>
      </main>
    </div>
  );
}

function StatCard({ title, value, note, link, chart }) {
  return (
    <div className="stat-card">
      <p>{title}</p>
      <h2>{value}</h2>
      <small>{note}</small>
      {chart && <div className="mini-chart"></div>}
      {link && <a>{link}</a>}
    </div>
  );
}

function DashboardCard({ title, children, tabs, small }) {
  return (
    <div className={`dash-card ${small ? "small-card" : ""}`}>
      <div className="card-head">
        <h3>{title}</h3>
        {tabs ? <div className="tabs">{tabs.map(t => <span key={t}>{t}</span>)}</div> : <a>View all</a>}
      </div>
      {children}
    </div>
  );
}

function OpportunityRow({ data, showMatch }) {
  return (
    <div className="opportunity-row">
      <div className="logo-box">{data[0][0]}</div>
      <div>
        <strong>{data[0]}</strong>
        <p>{data[1]}</p>
        <span>{data[3]}</span>
        {showMatch && <span className="match">{data[4]}</span>}
      </div>
      <small>{data[2]}</small>
    </div>
  );
}

function getIcon(item) {
  const icons = {
    Dashboard: "â–¦",
    Opportunities: "ðŸ’¼",
    Saved: "ðŸ”–",
    Applications: "â˜‘",
    Alerts: "ðŸ””",
    "Profile Builder": "ðŸ‘¥",
    "AI Assistant": "ðŸ¤–",
    "CV & Documents": "ðŸ“",
    Analytics: "ðŸ“Š",
    Premium: "â˜†",
    Settings: "âš™",
    "Help & Support": "?",
    Logout: "â†ª",
  };

  return icons[item] || "â€¢";
}
