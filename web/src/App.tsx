import { useState } from 'react';
import { AppProvider } from './store';
import { Shell, type NavKey } from './components/Shell';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Stats from './pages/Stats';
import Budgets from './pages/Budgets';
import Categories from './pages/Categories';
import Accounts from './pages/Accounts';
import Settings from './pages/Settings';

export default function App() {
  const [page, setPage] = useState<NavKey>('dashboard');

  return (
    <AppProvider>
      <Shell page={page} setPage={setPage}>
        {page === 'dashboard' && <Dashboard go={setPage} />}
        {page === 'transactions' && <Transactions />}
        {page === 'stats' && <Stats />}
        {page === 'budgets' && <Budgets />}
        {page === 'categories' && <Categories />}
        {page === 'accounts' && <Accounts />}
        {page === 'settings' && <Settings />}
      </Shell>
    </AppProvider>
  );
}
