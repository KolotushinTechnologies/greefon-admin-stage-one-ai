import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "../lib/api";
import { bindActivityTracking, shouldShowBoot } from "../lib/activity";
import { ScopeProvider, useScope } from "../lib/scope";
import { EventsScreen } from "../screens/Events";
import { GroupsBlock } from "../screens/Groups";
import { HallsScreen } from "../screens/Halls";
import { JournalScreen } from "../screens/Journal";
import { LoginScreen } from "../screens/Login";
import { PaymentsScreen } from "../screens/Payments";
import { PeopleScreen } from "../screens/People";
import { StaffScreen } from "../screens/Staff";
import { TodayScreen } from "../screens/Today";
import { BootSplash } from "../ui/Boot";
import { Shell } from "./Shell";
import ui from "../screens/ui.module.css";

function Guard({ children }: { children: ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <ScopeProvider>{children}</ScopeProvider>;
}

function BootGate({ children }: { children: ReactNode }) {
  const { branchCrmId } = useScope();
  const [booting, setBooting] = useState(() => shouldShowBoot());
  const done = useCallback(() => setBooting(false), []);

  useEffect(() => bindActivityTracking(), []);

  if (booting) {
    return <BootSplash branchCrmId={branchCrmId} onDone={done} />;
  }
  return children;
}

function GroupsScreen() {
  return (
    <Shell title="Залы">
      <div className={ui.pageHead}>
        <h2>Группы</h2>
      </div>
      <GroupsBlock />
    </Shell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route
        path="/*"
        element={
          <Guard>
            <BootGate>
              <Routes>
                <Route path="/" element={<TodayScreen />} />
                <Route path="/people" element={<PeopleScreen />} />
                <Route path="/halls" element={<HallsScreen />} />
                <Route path="/groups" element={<GroupsScreen />} />
                <Route path="/journal" element={<JournalScreen />} />
                <Route path="/payments" element={<PaymentsScreen />} />
                <Route path="/events" element={<EventsScreen />} />
                <Route path="/staff" element={<StaffScreen />} />
              </Routes>
            </BootGate>
          </Guard>
        }
      />
    </Routes>
  );
}
