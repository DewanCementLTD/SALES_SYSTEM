'use client';

// Delivery orders (PRD 4.8, TASKS P2-06). DOs are created by confirming an OC.
import { Truck } from 'lucide-react';
import { DoList } from '@/components/delivery/do-list';

export default function DoPage() {
  return (
    <DoList
      icon={Truck}
      title="Delivery orders"
      subtitle="Created by confirming an order confirmation, one per schedule line. Print, send to the dealer, hold or cancel from the DO."
      crumb="Delivery orders"
    />
  );
}
